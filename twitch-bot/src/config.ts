import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variable d'environnement manquante : ${name} (voir .env.example)`);
  return value;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (Number.isNaN(n)) throw new Error(`${name} doit être un nombre (reçu "${raw}")`);
  return n;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.toLowerCase();
  if (raw === undefined || raw === "") return fallback;
  return ["1", "true", "yes", "oui", "on"].includes(raw);
}

function list(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export const config = {
  twitch: {
    clientId: required("TWITCH_CLIENT_ID"),
    clientSecret: required("TWITCH_CLIENT_SECRET"),
    /** Compte du bot (doit être modérateur de la chaîne). */
    botUsername: required("TWITCH_BOT_USERNAME").toLowerCase(),
    accessToken: required("TWITCH_BOT_ACCESS_TOKEN"),
    refreshToken: process.env.TWITCH_BOT_REFRESH_TOKEN ?? "",
    /** Ta chaîne (le streamer). */
    channel: required("TWITCH_CHANNEL").toLowerCase().replace(/^#/, ""),
  },
  ai: {
    model: process.env.CLAUDE_MODEL ?? "claude-opus-5-5",
    effort: (process.env.CLAUDE_EFFORT ?? "low") as "low" | "medium" | "high",
  },
  bot: {
    /** Nom affiché / personnalité du bot. */
    persona: process.env.BOT_PERSONA ?? "",
    streamerNickname: process.env.STREAMER_NICKNAME ?? "",
    timezone: process.env.TIMEZONE ?? "Europe/Paris",
    /** Infos libres que le bot peut donner (réseaux, setup, règles…). */
    extraInfo: process.env.BOT_EXTRA_INFO ?? "",
    /** Délai minimum entre deux réponses IA pour un même viewer (secondes). */
    userCooldownSec: num("CHAT_USER_COOLDOWN_SEC", 20),
    /** Délai minimum entre deux réponses IA tout court (secondes). */
    globalCooldownSec: num("CHAT_GLOBAL_COOLDOWN_SEC", 4),
    /** Répondre aux questions sur planning/rediff même sans mention du bot. */
    answerKeywordQuestions: bool("ANSWER_KEYWORD_QUESTIONS", true),
  },
  clips: {
    enabled: bool("AUTOCLIP_ENABLED", true),
    /** Pas plus d'un clip auto toutes les N secondes. */
    cooldownSec: num("AUTOCLIP_COOLDOWN_SEC", 180),
    /** Multiplicateur d'activité par rapport à la normale pour suspecter un moment fort. */
    hypeRatio: num("AUTOCLIP_HYPE_RATIO", 2.5),
    /** Nombre minimum de messages dans la fenêtre pour déclencher. */
    minMessages: num("AUTOCLIP_MIN_MESSAGES", 8),
    /** Nombre de viewers différents tapant !clip pour forcer un clip. */
    clipVotes: num("CLIP_VOTES_REQUIRED", 3),
  },
  moderation: {
    enabled: bool("MODERATION_ENABLED", true),
    /** Mode test : le bot logue ce qu'il ferait sans rien supprimer ni timeout. */
    dryRun: bool("MODERATION_DRY_RUN", false),
    /** Modérer aussi les insultes entre viewers (sinon uniquement celles visant le streamer). */
    protectViewers: bool("MODERATION_PROTECT_VIEWERS", false),
    timeoutSec: num("MODERATION_TIMEOUT_SEC", 600),
    /** Nombre d'avertissements avant timeout. */
    strikesBeforeTimeout: num("MODERATION_STRIKES_BEFORE_TIMEOUT", 2),
    /** Pseudos jamais sanctionnés (amis proches qui chambrent). */
    trustedUsers: list("MODERATION_TRUSTED_USERS"),
  },
  dataDir: process.env.DATA_DIR ?? "data",
};

export type Config = typeof config;
