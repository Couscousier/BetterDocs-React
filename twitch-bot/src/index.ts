import tmi from "tmi.js";
import { ChatHistory, type ChatLine } from "./chatHistory.js";
import { config } from "./config.js";
import { Assistant } from "./features/assistant.js";
import { AutoClipper } from "./features/autoclip.js";
import { Moderation } from "./features/moderation.js";
import { log } from "./log.js";
import { TwitchApi } from "./twitch/api.js";

async function main(): Promise<void> {
  const api = new TwitchApi();
  await api.init();
  log.info(`Connecté à l'API Twitch : chaîne ${config.twitch.channel} (${api.broadcasterId}), bot ${config.twitch.botUsername}`);

  const channel = `#${config.twitch.channel}`;
  const client = new tmi.Client({
    options: { skipUpdatingEmotesets: true },
    connection: { reconnect: true, secure: true },
    identity: {
      username: config.twitch.botUsername,
      // Fonction : tmi relit le token (éventuellement rafraîchi) à chaque reconnexion.
      password: () => `oauth:${api.token}`,
    },
    channels: [channel],
  });

  const say = async (text: string, replyTo?: string): Promise<void> => {
    try {
      if (replyTo) await client.raw(`@reply-parent-msg-id=${replyTo} PRIVMSG ${channel} :${text}`);
      else await client.say(channel, text);
    } catch (err) {
      log.error("Envoi du message impossible :", err);
    }
  };

  // État du live, rafraîchi chaque minute.
  let live = false;
  const refreshLive = async () => {
    const was = live;
    live = !!(await api.getStream().catch(() => null));
    if (live !== was) log.info(live ? "🔴 Live détecté." : "⚫ Live terminé.");
  };
  await refreshLive();
  setInterval(() => void refreshLive(), 60_000);

  const history = new ChatHistory();
  const moderation = new Moderation(history, {
    say,
    deleteMessage: (id) => api.deleteMessage(id),
    timeout: (userId, seconds, reason) => api.timeoutUser(userId, seconds, reason),
  });
  const clipper = new AutoClipper(history, {
    isLive: () => live,
    createClip: () => api.createClip(),
    say: (text) => say(text),
  });
  const assistant = new Assistant(api, history, {
    say,
    isLive: () => live,
    requestClip: (line) => clipper.onClipCommand(line),
  });

  client.on("message", (_channel, tags, message, self) => {
    if (self || tags.username?.toLowerCase() === config.twitch.botUsername) return;
    const line: ChatLine = {
      id: tags.id ?? "",
      userId: tags["user-id"] ?? "",
      user: tags["display-name"] ?? tags.username ?? "inconnu",
      text: message,
      at: Date.now(),
      isMod: !!tags.mod,
      isVip: !!tags.badges?.vip,
      isSub: !!tags.subscriber,
      isBroadcaster: !!tags.badges?.broadcaster,
    };
    history.push(line);
    clipper.onMessage(line);
    void handle(line);
  });

  async function handle(line: ChatLine): Promise<void> {
    try {
      // 1. Modération d'abord : un message sanctionné n'obtient pas de réponse.
      if (await moderation.handle(line)) return;
      // 2. Commandes rapides.
      if (line.text.startsWith("!") && (await assistant.handleCommand(line))) return;
      // 3. Discussion avec l'IA.
      if (assistant.shouldAnswer(line)) await assistant.answer(line);
    } catch (err) {
      log.error("Erreur pendant le traitement d'un message :", err);
    }
  }

  client.on("connected", () => log.info(`💬 Bot connecté au chat ${channel}`));
  client.on("disconnected", (reason) => log.warn(`Déconnecté du chat : ${reason}`));

  await client.connect();
  clipper.start();

  const shutdown = async () => {
    log.info("Arrêt du bot…");
    clipper.stop();
    await client.disconnect().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  log.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
