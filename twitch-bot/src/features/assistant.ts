import type Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod/v4";
import { converse } from "../ai/claude.js";
import { ChatHistory, type ChatLine } from "../chatHistory.js";
import { config } from "../config.js";
import { log } from "../log.js";
import type { ScheduleSegment, TwitchApi, Video } from "../twitch/api.js";

/**
 * Discussion avec les viewers + infos chaîne (planning, rediffusions, clips).
 * Le bot répond quand on le mentionne (@bot), avec !ia <question>, ou quand quelqu'un
 * pose une question sur le planning / les rediffs.
 */

const KEYWORD_TRIGGER =
  /(prochain(?:e)? (?:live|stream)|planning|programme|quand (?:est|c'est|y a) (?:le )?(?:prochain|live|stream)|rediff|replay|\bvod\b|j'ai rat[ée]|rat[ée] le (?:live|stream|début)|c'[ée]tait quoi (?:hier|le live))/i;

const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: config.bot.timezone,
  }).format(new Date(iso));

export function formatSchedule(segments: ScheduleSegment[], vacation: { start_time: string; end_time: string } | null): string {
  const upcoming = segments.filter((s) => !s.canceled_until && new Date(s.end_time ?? s.start_time).getTime() > Date.now());
  const lines = upcoming.map((s) => `${fmtDate(s.start_time)} : ${s.title || "Live"}${s.category ? ` (${s.category.name})` : ""}`);
  if (vacation) lines.unshift(`En pause du ${fmtDate(vacation.start_time)} au ${fmtDate(vacation.end_time)}`);
  return lines.length ? lines.join("\n") : "Aucun live programmé dans le planning Twitch.";
}

export function formatVideos(videos: Video[]): string {
  if (!videos.length) return "Aucune vidéo disponible.";
  return videos.map((v) => `${fmtDate(v.created_at)} | ${v.title} | durée ${v.duration} | ${v.url}`).join("\n");
}

/** Nettoie la réponse pour le chat Twitch (pas de markdown, 500 caractères max). */
export function toChat(text: string): string {
  const clean = text
    .replace(/\*\*|__|`/g, "")
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, "$1 $2")
    .replace(/^#+\s*/gm, "")
    .replace(/\s*\n+\s*/g, " ")
    .trim();
  return clean.length > 480 ? clean.slice(0, 477).trimEnd() + "…" : clean;
}

export class Assistant {
  private lastByUser = new Map<string, number>();
  private lastGlobal = 0;
  private memory = new Map<string, Anthropic.Beta.BetaMessageParam[]>();
  private readonly mentionRe: RegExp;

  constructor(
    private readonly api: TwitchApi,
    private readonly history: ChatHistory,
    private readonly deps: {
      say: (text: string, replyTo?: string) => Promise<void>;
      isLive: () => boolean;
      requestClip: (line: ChatLine) => Promise<void>;
    },
  ) {
    this.mentionRe = new RegExp(`@?${config.twitch.botUsername}\\b`, "i");
  }

  shouldAnswer(line: ChatLine): boolean {
    if (/^!(ia|bot|ask)\b/i.test(line.text)) return true;
    if (this.mentionRe.test(line.text)) return true;
    return config.bot.answerKeywordQuestions && KEYWORD_TRIGGER.test(line.text) && line.text.includes("?");
  }

  /** Commandes rapides qui ne nécessitent pas l'IA. Retourne true si traitée. */
  async handleCommand(line: ChatLine): Promise<boolean> {
    const cmd = line.text.trim().split(/\s+/)[0]?.toLowerCase();
    switch (cmd) {
      case "!planning":
      case "!programme":
      case "!schedule": {
        const { segments, vacation } = await this.api.getSchedule(5);
        const text = formatSchedule(segments.slice(0, 3), vacation).replace(/\n/g, " | ");
        await this.deps.say(toChat(`📅 ${text} — planning complet : https://twitch.tv/${config.twitch.channel}/schedule`), line.id);
        return true;
      }
      case "!rediff":
      case "!replay":
      case "!vod": {
        const [last] = await this.api.getVideos("archive", 1);
        await this.deps.say(
          last ? `📼 Dernière rediff : « ${last.title} » → ${last.url} (toutes les rediffs : https://twitch.tv/${config.twitch.channel}/videos)` : "Pas de rediffusion disponible pour l'instant.",
          line.id,
        );
        return true;
      }
      case "!clip":
        await this.deps.requestClip(line);
        return true;
      default:
        return false;
    }
  }

  async answer(line: ChatLine): Promise<void> {
    const now = Date.now();
    if (now - (this.lastByUser.get(line.userId) ?? 0) < config.bot.userCooldownSec * 1000) return;
    if (now - this.lastGlobal < config.bot.globalCooldownSec * 1000) return;
    this.lastByUser.set(line.userId, now);
    this.lastGlobal = now;

    const question = line.text.replace(/^!(ia|bot|ask)\s*/i, "").replace(this.mentionRe, "").trim();
    if (!question) {
      await this.deps.say(`Yo @${line.user} ! Pose-moi ta question 😄`, line.id);
      return;
    }

    const past = this.memory.get(line.userId) ?? [];
    const nowText = new Intl.DateTimeFormat("fr-FR", { dateStyle: "full", timeStyle: "short", timeZone: config.bot.timezone }).format(new Date());
    const userTurn: Anthropic.Beta.BetaMessageParam = {
      role: "user",
      content: `[Date actuelle : ${nowText} (${config.bot.timezone}) — live en cours : ${this.deps.isLive() ? "oui" : "non"}]
[Derniers messages du chat]
${ChatHistory.format(this.history.recent(12))}

${line.user}${line.isMod ? " (modo)" : line.isVip ? " (vip)" : ""} te dit : ${question}`,
    };

    const reply = await converse({ system: this.systemPrompt(), tools: this.tools(line), messages: [...past, userTurn] });
    if (!reply) return;
    const chatText = toChat(reply);
    await this.deps.say(chatText, line.id);
    log.info(`[assistant] ${line.user}: ${question} -> ${chatText}`);

    // Petite mémoire par viewer (3 derniers échanges), sans le contexte du chat pour rester léger.
    const updated: Anthropic.Beta.BetaMessageParam[] = [...past, { role: "user", content: question }, { role: "assistant", content: chatText }];
    this.memory.set(line.userId, updated.slice(-6));
  }

  private systemPrompt(): string {
    const streamer = config.bot.streamerNickname || config.twitch.channel;
    return `Tu es ${config.twitch.botUsername}, le bot IA du chat Twitch de ${streamer} (https://twitch.tv/${config.twitch.channel}).
${config.bot.persona ? `Personnalité : ${config.bot.persona}\n` : ""}
Style : tu parles comme un viewer sympa du chat, en français (ou dans la langue du viewer), tutoiement, une à trois phrases max, 400 caractères max, aucun markdown, emojis avec parcimonie. Tu peux chambrer gentiment mais jamais être méchant.

Ce que tu sais faire :
- Donner le planning des prochains lives : utilise TOUJOURS l'outil get_schedule, n'invente jamais de date ni d'heure. Les heures sont en ${config.bot.timezone}.
- Rediriger vers les rediffusions : si quelqu'un a raté un live ou demande ce qui s'est passé, utilise get_videos et donne le lien direct de la bonne vidéo.
- Donner l'état du live (get_stream_status) et les meilleurs clips récents (get_top_clips).
- Créer un clip (create_clip) uniquement si l'outil est disponible pour ce viewer.
- Discuter de tout et de rien avec les viewers.

Limites : pas de sujets haineux, pas d'infos personnelles sur le streamer ou les viewers, pas de conseils dangereux. Si tu ne sais pas, dis-le simplement.
${config.bot.extraInfo ? `\nInfos sur la chaîne :\n${config.bot.extraInfo}` : ""}`;
  }

  private tools(line: ChatLine) {
    const tools = [
      betaZodTool({
        name: "get_schedule",
        description: "Planning Twitch des prochains lives (dates, heures, titres, jeux) et éventuelle période de pause.",
        inputSchema: z.object({}),
        run: async () => {
          const { segments, vacation } = await this.api.getSchedule(10);
          return formatSchedule(segments, vacation);
        },
      }),
      betaZodTool({
        name: "get_videos",
        description: "Liste les dernières vidéos de la chaîne avec leurs liens. 'archive' = rediffusions complètes des lives, 'highlight' = temps forts.",
        inputSchema: z.object({
          type: z.enum(["archive", "highlight"]).default("archive"),
          limit: z.number().int().min(1).max(10).default(5),
        }),
        run: async ({ type, limit }) => formatVideos(await this.api.getVideos(type, limit)),
      }),
      betaZodTool({
        name: "get_stream_status",
        description: "Indique si le live est en cours, avec titre, jeu, nombre de viewers et durée.",
        inputSchema: z.object({}),
        run: async () => {
          const s = await this.api.getStream();
          if (!s) return "Hors ligne.";
          const mins = Math.round((Date.now() - new Date(s.started_at).getTime()) / 60000);
          return `En live depuis ${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, "0")} | ${s.title} | ${s.game_name} | ${s.viewer_count} viewers`;
        },
      }),
      betaZodTool({
        name: "get_top_clips",
        description: "Meilleurs clips récents de la chaîne avec leurs liens.",
        inputSchema: z.object({ days: z.number().int().min(1).max(60).default(7) }),
        run: async ({ days }) => {
          const clips = await this.api.getTopClips(5, days);
          return clips.length ? clips.map((c) => `${c.title} → ${c.url}`).join("\n") : "Aucun clip sur cette période.";
        },
      }),
    ];

    // Seuls le streamer, les modos et les VIP peuvent demander un clip en langage naturel.
    if (line.isBroadcaster || line.isMod || line.isVip) {
      tools.push(
        betaZodTool({
          name: "create_clip",
          description: "Crée un clip des 30 dernières secondes du live et l'annonce dans le chat. N'utilise que si le viewer le demande explicitement.",
          inputSchema: z.object({}),
          run: async () => {
            if (!this.deps.isLive()) return "Impossible : le live n'est pas en cours.";
            await this.deps.requestClip(line);
            return "Demande de clip envoyée ; le lien sera posté dans le chat par le module clip.";
          },
        }),
      );
    }
    return tools;
  }
}
