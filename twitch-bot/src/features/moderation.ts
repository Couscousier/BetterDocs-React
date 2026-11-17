import * as z from "zod/v4";
import { classify } from "../ai/claude.js";
import { ChatHistory, type ChatLine } from "../chatHistory.js";
import { config } from "../config.js";
import { log } from "../log.js";

/**
 * Modération des insultes.
 *
 * 1. Pré-filtre local gratuit : on ne sollicite l'IA que si le message contient un mot
 *    potentiellement insultant (avec normalisation du leet speak, des accents, des lettres répétées).
 * 2. Claude juge le message AVEC le contexte du chat : à qui il s'adresse, et si c'est de la
 *    vraie hostilité ou de la taquinerie / du second degré ("t'es nul mdr KEKW").
 * 3. Une politique déterministe décide de la sanction (avertissement, suppression, timeout).
 */

const LEXICON = [
  // FR
  "con", "conne", "connard", "connasse", "salope", "salaud", "pute", "putain", "fdp", "ntm", "nique", "niquer",
  "encule", "enculer", "batard", "merde", "merdique", "debile", "abruti", "cretin", "idiot", "imbecile", "nul", "nulle",
  "naze", "bouffon", "guignol", "clochard", "clown", "tg", "ftg", "gueule", "chier", "degueulasse", "moche", "laid",
  "grosse", "gros", "boloss", "bolosse", "teubé", "teube", "attarde", "mongol", "pd", "tapette", "gouine", "pute",
  "crève", "creve", "suicide", "dégage", "degage", "honte", "pathetique", "minable", "rageux", "cassos", "tocard",
  "trouduc", "pourri", "pourrie", "escroc", "arnaqueur",
  // EN
  "stupid", "idiot", "dumb", "trash", "garbage", "sucks", "loser", "fuck", "fucking", "bitch", "retard", "retarded",
  "ugly", "fat", "kys", "kill yourself", "shut up", "stfu", "noob", "clown", "pathetic", "cringe", "fraud", "scam",
];

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "€": "e" };

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[013457@$€]/g, (c) => LEET[c] ?? c)
    .replace(/[._\-*]/g, "")
    // Lettres répétées réduites à une seule ("connnnard" -> "conard"), appliqué
    // aussi au lexique pour que la comparaison reste cohérente.
    .replace(/([a-z])\1+/g, "$1");
}

const LEXICON_NORMALIZED = [...new Set(LEXICON.map((w) => normalize(w)))];

/** Vrai si le message mérite d'être analysé par l'IA. */
export function mightBeInsult(text: string): boolean {
  const norm = ` ${normalize(text).replace(/[^a-z0-9\s']/g, " ")} `;
  return LEXICON_NORMALIZED.some((w) => {
    // mots courts : on exige des frontières de mot pour éviter "concert", "contre"…
    if (w.length <= 4) return new RegExp(`[\\s']${w}[\\s']`).test(norm);
    return norm.includes(w);
  });
}

export const VerdictSchema = z.object({
  target: z.enum(["streamer", "viewer", "bot", "personne"]).describe("Qui est visé par le message"),
  tone: z.enum(["humour", "hostile", "neutre"]).describe("humour = taquinerie/second degré/chambrage amical"),
  is_insult: z.boolean().describe("Vrai seulement s'il s'agit d'une vraie insulte ou attaque, pas d'une blague"),
  severity: z.number().int().min(0).max(3).describe("0 rien, 1 impoli, 2 insulte claire, 3 haine/harcèlement/menace/insulte discriminatoire"),
  reason: z.string().describe("Justification courte"),
  reply: z.string().describe("Message court et calme à envoyer dans le chat si une intervention est utile, sinon chaîne vide"),
});
export type Verdict = z.infer<typeof VerdictSchema>;

export interface ModerationAction {
  warn: boolean;
  deleteMessage: boolean;
  timeout: boolean;
}

/** Politique de sanction (pure, testée unitairement). */
export function decideAction(v: Verdict, previousStrikes: number, opts: { protectViewers: boolean; strikesBeforeTimeout: number }): ModerationAction {
  const none = { warn: false, deleteMessage: false, timeout: false };
  if (!v.is_insult || v.tone === "humour" || v.severity === 0) return none;
  const protectedTarget = v.target === "streamer" || v.target === "bot" || (opts.protectViewers && v.target === "viewer");
  if (!protectedTarget) return none;

  if (v.severity >= 3) return { warn: true, deleteMessage: true, timeout: true };
  const strikes = previousStrikes + 1;
  if (strikes > opts.strikesBeforeTimeout) return { warn: true, deleteMessage: true, timeout: true };
  return { warn: true, deleteMessage: v.severity >= 2, timeout: false };
}

const SYSTEM = `Tu es le modérateur IA du chat Twitch de ${config.bot.streamerNickname || config.twitch.channel}.
Ta mission : repérer les VRAIES insultes et attaques, surtout envers le streamer, sans casser l'ambiance.

Règles d'interprétation :
- Le chat Twitch chambre énormément. "t'es nul", "bouffon", "le noob", "il est éclaté" accompagnés d'emotes (KEKW, LUL, OMEGALUL, mdr, ptdr, xD, 😂), suite à une action ratée en jeu, ou entre habitués, c'est de l'HUMOUR : tone="humour", is_insult=false.
- Les jurons d'exclamation ("putain le clutch !", "merde j'ai raté le début") ne visent personne : target="personne", is_insult=false.
- Une insulte est hostile quand elle est gratuite, répétée, méprisante, vise le physique, la vie privée, la famille, ou souhaite du mal. Les insultes discriminatoires (racistes, homophobes, sexistes…), menaces et incitations au suicide sont toujours severity=3, même "pour rire".
- Regarde l'historique récent de l'auteur : un viewer qui enchaîne les attaques n'est pas en train de blaguer.
- "reply" : si une intervention est utile, une phrase courte, ferme mais pas agressive, en français, sans markdown. Sinon "".`;

export class Moderation {
  private strikes = new Map<string, { count: number; last: number }>();

  constructor(
    private readonly history: ChatHistory,
    private readonly actions: {
      say: (text: string, replyTo?: string) => Promise<void>;
      deleteMessage: (id: string) => Promise<boolean>;
      timeout: (userId: string, seconds: number, reason: string) => Promise<boolean>;
    },
  ) {}

  /** Retourne true si le message a été sanctionné (et ne doit donc plus être traité). */
  async handle(line: ChatLine): Promise<boolean> {
    if (!config.moderation.enabled) return false;
    if (line.isBroadcaster || line.isMod) return false;
    if (config.moderation.trustedUsers.includes(line.user.toLowerCase())) return false;
    if (!mightBeInsult(line.text)) return false;

    const context = ChatHistory.format(this.history.recent(15));
    const authorHistory = ChatHistory.format(this.history.fromUser(line.userId, 6));
    const verdict = await classify({
      system: SYSTEM,
      schema: VerdictSchema,
      prompt: `Contexte récent du chat :\n${context}\n\nDerniers messages de ${line.user} :\n${authorHistory}\n\nMessage à juger (de ${line.user}) :\n${line.text}`,
    });
    if (!verdict) return false;

    const key = line.userId;
    const entry = this.strikes.get(key);
    // Les avertissements expirent au bout d'une heure.
    const previous = entry && Date.now() - entry.last < 3600_000 ? entry.count : 0;
    const action = decideAction(verdict, previous, config.moderation);

    log.info(`[modération] ${line.user}: "${line.text}" -> ${verdict.target}/${verdict.tone}/sev${verdict.severity} (${verdict.reason})`);
    if (!action.warn && !action.deleteMessage && !action.timeout) return false;

    this.strikes.set(key, { count: previous + 1, last: Date.now() });

    if (config.moderation.dryRun) {
      log.action(`[DRY RUN] aurait appliqué ${JSON.stringify(action)} à ${line.user}`);
      return false;
    }

    if (action.deleteMessage) await this.actions.deleteMessage(line.id);
    if (action.timeout) {
      await this.actions.timeout(line.userId, config.moderation.timeoutSec, `IA : ${verdict.reason}`);
      log.action(`Timeout ${config.moderation.timeoutSec}s pour ${line.user}`);
    }
    const reply = verdict.reply || `@${line.user} on reste respectueux ici, merci.`;
    await this.actions.say(action.timeout ? `${line.user} prend une petite pause. ${reply}` : reply, action.deleteMessage ? undefined : line.id);
    return action.deleteMessage || action.timeout;
  }
}
