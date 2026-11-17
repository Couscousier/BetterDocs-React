import fs from "node:fs";
import path from "node:path";
import * as z from "zod/v4";
import { classify } from "../ai/claude.js";
import { ChatHistory, type ChatLine } from "../chatHistory.js";
import { config } from "../config.js";
import { log } from "../log.js";
import type { Clip } from "../twitch/api.js";

/**
 * Clips autonomes.
 *
 * Le bot surveille le rythme du chat. Quand l'activité explose par rapport à la normale
 * (et/ou que les réactions type KEKW, POG, "CLIP", "mdr"… se multiplient), il demande à Claude
 * de lire les derniers messages pour juger si c'est un vrai moment fort. Si oui : clip + titre
 * généré + annonce dans le chat. Les viewers peuvent aussi voter avec !clip.
 */

const HYPE_TOKENS = [
  "kekw", "lul", "lol", "omegalul", "pog", "pogchamp", "poggers", "pogu", "mdr", "ptdr", "xd", "clip", "wtf", "omg",
  "gg", "goat", "insane", "incroyable", "dinguerie", "masterclass", "😂", "🤣", "💀", "🔥", "!!!", "?!", "monkas", "pepelaugh",
];

export function isHypeMessage(text: string): boolean {
  const t = text.toLowerCase();
  return HYPE_TOKENS.some((k) => t.includes(k)) || (text.length >= 4 && text === text.toUpperCase() && /[A-Z]{4,}/.test(text));
}

/** Détecteur de pics d'activité (pur, testable). */
export class HypeDetector {
  private stamps: { at: number; hype: boolean }[] = [];
  private baseline = 0; // messages moyens par fenêtre
  private ready = false;

  constructor(private readonly windowMs = 15_000) {}

  record(at: number, text: string): void {
    this.stamps.push({ at, hype: isHypeMessage(text) });
  }

  /** À appeler régulièrement. Retourne un score > 0 si un pic est détecté. */
  tick(now: number, opts: { ratio: number; minMessages: number }): { spike: boolean; count: number; baseline: number; hypeShare: number } {
    this.stamps = this.stamps.filter((s) => now - s.at <= this.windowMs * 8);
    const inWindow = this.stamps.filter((s) => now - s.at <= this.windowMs);
    const count = inWindow.length;
    const hypeShare = count ? inWindow.filter((s) => s.hype).length / count : 0;

    const baseline = Math.max(this.baseline, 1);
    const spike =
      this.ready &&
      count >= opts.minMessages &&
      (count / baseline >= opts.ratio || (hypeShare >= 0.5 && count / baseline >= opts.ratio * 0.6));

    // Moyenne mobile exponentielle, mise à jour lentement et sans intégrer les pics.
    if (!spike) {
      this.baseline = this.ready ? this.baseline * 0.95 + count * 0.05 : count;
      this.ready = true;
    }
    return { spike, count, baseline, hypeShare };
  }
}

const DecisionSchema = z.object({
  clip: z.boolean().describe("Vrai si c'est un vrai moment fort qui mérite un clip"),
  title: z.string().describe("Titre de clip accrocheur, max 60 caractères, en français, sans hashtag"),
  announcement: z.string().describe("Courte phrase fun pour annoncer le clip dans le chat (sans le lien)"),
  reason: z.string(),
});

const SYSTEM = `Tu es l'assistant clip d'une chaîne Twitch. On te donne les derniers messages du chat pendant un pic d'activité.
Décide s'il s'est passé un vrai moment fort à clipper (action incroyable, fail hilarant, réaction énorme, annonce, moment émouvant).
Ne clippe PAS pour : un raid/host, une vague de sub gifts sans contexte, du spam, une pub, un chat qui parle d'autre chose, ou un début/fin de live.
Le titre doit donner envie de cliquer et refléter ce que le chat décrit. Réponds en français.`;

export class AutoClipper {
  private detector = new HypeDetector();
  private lastClipAt = 0;
  private busy = false;
  private votes = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly history: ChatHistory,
    private readonly deps: {
      isLive: () => boolean;
      createClip: () => Promise<Clip | null>;
      say: (text: string) => Promise<void>;
    },
  ) {}

  start(): void {
    if (!config.clips.enabled) return;
    this.timer = setInterval(() => void this.evaluate(), 5_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  onMessage(line: ChatLine): void {
    this.detector.record(line.at, line.text);
  }

  /** Commande !clip : les modos/streamer clippent directement, les viewers votent. */
  async onClipCommand(line: ChatLine): Promise<void> {
    if (!this.deps.isLive()) return;
    if (line.isBroadcaster || line.isMod) {
      await this.makeClip({ reason: `demandé par ${line.user}`, judge: false });
      return;
    }
    const now = Date.now();
    for (const [u, t] of this.votes) if (now - t > 30_000) this.votes.delete(u);
    this.votes.set(line.userId, now);
    if (this.votes.size >= config.clips.clipVotes) {
      this.votes.clear();
      await this.makeClip({ reason: `vote du chat (${config.clips.clipVotes} viewers)`, judge: false });
    }
  }

  private async evaluate(): Promise<void> {
    if (!this.deps.isLive() || this.busy) return;
    const res = this.detector.tick(Date.now(), { ratio: config.clips.hypeRatio, minMessages: config.clips.minMessages });
    if (!res.spike) return;
    log.info(`[clip] Pic détecté : ${res.count} msg/15s (normale ~${res.baseline.toFixed(1)}), ${(res.hypeShare * 100).toFixed(0)}% de réactions`);
    await this.makeClip({ reason: "pic d'activité", judge: true });
  }

  private async makeClip(opts: { reason: string; judge: boolean }): Promise<void> {
    if (this.busy) return;
    if (Date.now() - this.lastClipAt < config.clips.cooldownSec * 1000) {
      log.info(`[clip] Ignoré (${opts.reason}) : cooldown actif.`);
      return;
    }
    this.busy = true;
    try {
      // On lance le clip tout de suite (il capture les ~30 dernières secondes) pendant que l'IA réfléchit.
      const clipPromise = opts.judge ? null : this.deps.createClip();
      const decision = await classify({
        system: SYSTEM,
        schema: DecisionSchema,
        prompt: `Raison du déclenchement : ${opts.reason}\n\nDerniers messages du chat :\n${ChatHistory.format(this.history.since(45_000))}`,
      });

      if (opts.judge && !decision?.clip) {
        log.info(`[clip] L'IA ne clippe pas : ${decision?.reason ?? "pas de réponse"}`);
        return;
      }
      const clip = await (clipPromise ?? this.deps.createClip());
      if (!clip) return;
      this.lastClipAt = Date.now();

      const title = decision?.title || "Moment fort";
      const announcement = decision?.announcement || "Nouveau clip !";
      await this.deps.say(`🎬 ${announcement} « ${title} » → ${clip.url}`);
      log.action(`[clip] ${title} ${clip.url} (${opts.reason})`);
      this.saveClip({ ...clip, title, reason: opts.reason, aiReason: decision?.reason ?? "" });
    } finally {
      this.busy = false;
    }
  }

  private saveClip(entry: Record<string, unknown>): void {
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.appendFileSync(path.join(config.dataDir, "clips.jsonl"), JSON.stringify(entry) + "\n");
  }
}
