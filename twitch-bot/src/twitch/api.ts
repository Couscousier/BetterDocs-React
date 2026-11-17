import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { log } from "../log.js";

/**
 * Petit client pour l'API Helix de Twitch.
 * Utilise le token utilisateur du bot (rafraîchi automatiquement si un refresh token est fourni).
 */

const HELIX = "https://api.twitch.tv/helix";
const tokenFile = () => path.join(config.dataDir, "tokens.json");

export interface ScheduleSegment {
  id: string;
  start_time: string;
  end_time: string | null;
  title: string;
  canceled_until: string | null;
  category: { id: string; name: string } | null;
  is_recurring: boolean;
}

export interface Video {
  id: string;
  title: string;
  url: string;
  created_at: string;
  duration: string;
  view_count: number;
  description: string;
}

export interface StreamInfo {
  title: string;
  game_name: string;
  viewer_count: number;
  started_at: string;
}

export interface Clip {
  id: string;
  url: string;
  title: string;
  created_at: string;
}

export class TwitchApi {
  private accessToken: string;
  private refreshToken: string;
  broadcasterId = "";
  botUserId = "";

  constructor() {
    const saved = this.loadSavedTokens();
    this.accessToken = saved?.accessToken ?? config.twitch.accessToken;
    this.refreshToken = saved?.refreshToken ?? config.twitch.refreshToken;
  }

  get token(): string {
    return this.accessToken;
  }

  async init(): Promise<void> {
    await this.validate();
    const [broadcaster, bot] = await Promise.all([
      this.getUser(config.twitch.channel),
      this.getUser(config.twitch.botUsername),
    ]);
    if (!broadcaster) throw new Error(`Chaîne introuvable : ${config.twitch.channel}`);
    if (!bot) throw new Error(`Compte bot introuvable : ${config.twitch.botUsername}`);
    this.broadcasterId = broadcaster.id;
    this.botUserId = bot.id;
  }

  // ---------- Auth ----------

  private loadSavedTokens(): { accessToken: string; refreshToken: string } | null {
    try {
      return JSON.parse(fs.readFileSync(tokenFile(), "utf8"));
    } catch {
      return null;
    }
  }

  private saveTokens(): void {
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(
      tokenFile(),
      JSON.stringify({ accessToken: this.accessToken, refreshToken: this.refreshToken }, null, 2),
      { mode: 0o600 },
    );
  }

  private async validate(): Promise<void> {
    const res = await fetch("https://id.twitch.tv/oauth2/validate", {
      headers: { Authorization: `OAuth ${this.accessToken}` },
    });
    if (res.status === 401) {
      await this.refresh();
      return;
    }
    const body = (await res.json()) as { scopes?: string[] };
    const needed = [
      "chat:read",
      "chat:edit",
      "clips:edit",
      "moderator:manage:banned_users",
      "moderator:manage:chat_messages",
    ];
    const missing = needed.filter((s) => !body.scopes?.includes(s));
    if (missing.length) log.warn(`Scopes manquants sur le token du bot : ${missing.join(", ")}`);
  }

  async refresh(): Promise<void> {
    if (!this.refreshToken) {
      throw new Error("Token Twitch expiré et aucun TWITCH_BOT_REFRESH_TOKEN fourni. Relance `npm run auth`.");
    }
    const res = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: this.refreshToken,
        client_id: config.twitch.clientId,
        client_secret: config.twitch.clientSecret,
      }),
    });
    if (!res.ok) throw new Error(`Échec du rafraîchissement du token Twitch (${res.status}) : ${await res.text()}`);
    const body = (await res.json()) as { access_token: string; refresh_token: string };
    this.accessToken = body.access_token;
    this.refreshToken = body.refresh_token;
    this.saveTokens();
    log.info("Token Twitch rafraîchi.");
  }

  private async request<T>(method: string, endpoint: string, query: Record<string, string | number | undefined> = {}, body?: unknown, retry = true): Promise<{ status: number; data: T | null }> {
    const url = new URL(HELIX + endpoint);
    for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, String(v));

    const res = await fetch(url, {
      method,
      headers: {
        "Client-Id": config.twitch.clientId,
        Authorization: `Bearer ${this.accessToken}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401 && retry) {
      await this.refresh();
      return this.request<T>(method, endpoint, query, body, false);
    }
    if (res.status === 204) return { status: 204, data: null };
    const text = await res.text();
    if (!res.ok) {
      log.warn(`Helix ${method} ${endpoint} -> ${res.status} ${text}`);
      return { status: res.status, data: null };
    }
    return { status: res.status, data: text ? (JSON.parse(text) as T) : null };
  }

  // ---------- Lecture ----------

  async getUser(login: string): Promise<{ id: string; login: string; display_name: string } | null> {
    const { data } = await this.request<{ data: { id: string; login: string; display_name: string }[] }>("GET", "/users", { login });
    return data?.data[0] ?? null;
  }

  /** Planning des prochains lives (onglet "Planning" de la chaîne). */
  async getSchedule(limit = 10): Promise<{ segments: ScheduleSegment[]; vacation: { start_time: string; end_time: string } | null }> {
    const { status, data } = await this.request<{ data: { segments: ScheduleSegment[] | null; vacation: { start_time: string; end_time: string } | null } }>(
      "GET",
      "/schedule",
      { broadcaster_id: this.broadcasterId, first: limit },
    );
    if (status === 404 || !data) return { segments: [], vacation: null };
    return { segments: data.data.segments ?? [], vacation: data.data.vacation };
  }

  /** Dernières rediffusions (VOD de type archive) ou temps forts. */
  async getVideos(type: "archive" | "highlight" | "upload" = "archive", limit = 5): Promise<Video[]> {
    const { data } = await this.request<{ data: Video[] }>("GET", "/videos", {
      user_id: this.broadcasterId,
      type,
      first: limit,
      sort: "time",
    });
    return data?.data ?? [];
  }

  async getStream(): Promise<StreamInfo | null> {
    const { data } = await this.request<{ data: StreamInfo[] }>("GET", "/streams", { user_id: this.broadcasterId });
    return data?.data[0] ?? null;
  }

  async getTopClips(limit = 5, sinceDays = 7): Promise<Clip[]> {
    const started_at = new Date(Date.now() - sinceDays * 86400_000).toISOString();
    const { data } = await this.request<{ data: Clip[] }>("GET", "/clips", {
      broadcaster_id: this.broadcasterId,
      first: limit,
      started_at,
    });
    return data?.data ?? [];
  }

  // ---------- Clips ----------

  /**
   * Crée un clip des ~30 dernières secondes. Twitch traite le clip en asynchrone :
   * on attend qu'il soit disponible avant de renvoyer son URL publique.
   */
  async createClip(): Promise<Clip | null> {
    const { status, data } = await this.request<{ data: { id: string; edit_url: string }[] }>("POST", "/clips", {
      broadcaster_id: this.broadcasterId,
    });
    const created = data?.data[0];
    if (!created) {
      if (status === 404) log.warn("Impossible de clipper : la chaîne n'est pas en live.");
      return null;
    }
    for (let attempt = 0; attempt < 8; attempt++) {
      await new Promise((r) => setTimeout(r, 2500));
      const { data: clipData } = await this.request<{ data: Clip[] }>("GET", "/clips", { id: created.id });
      const clip = clipData?.data[0];
      if (clip) return clip;
    }
    // Pas encore indexé mais créé : on renvoie l'URL standard.
    return { id: created.id, url: `https://clips.twitch.tv/${created.id}`, title: "", created_at: new Date().toISOString() };
  }

  // ---------- Modération ----------

  async deleteMessage(messageId: string): Promise<boolean> {
    const { status } = await this.request("DELETE", "/moderation/chat", {
      broadcaster_id: this.broadcasterId,
      moderator_id: this.botUserId,
      message_id: messageId,
    });
    return status === 204;
  }

  async timeoutUser(userId: string, durationSec: number, reason: string): Promise<boolean> {
    const { status } = await this.request(
      "POST",
      "/moderation/bans",
      { broadcaster_id: this.broadcasterId, moderator_id: this.botUserId },
      { data: { user_id: userId, duration: durationSec, reason: reason.slice(0, 500) } },
    );
    return status === 200;
  }
}
