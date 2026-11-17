/**
 * Obtient un token utilisateur Twitch pour le compte du bot.
 * Usage : npm run auth  (avec TWITCH_CLIENT_ID et TWITCH_CLIENT_SECRET dans .env)
 * Dans la console Twitch Dev, ajoute http://localhost:3000 comme "OAuth Redirect URL".
 * Connecte-toi avec le COMPTE DU BOT (pas ta chaîne) quand le navigateur s'ouvre.
 */
import "dotenv/config";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const clientId = process.env.TWITCH_CLIENT_ID;
const clientSecret = process.env.TWITCH_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("Renseigne TWITCH_CLIENT_ID et TWITCH_CLIENT_SECRET dans .env d'abord.");
  process.exit(1);
}

const redirectUri = "http://localhost:3000";
const scopes = ["chat:read", "chat:edit", "clips:edit", "moderator:manage:banned_users", "moderator:manage:chat_messages"];
const state = Math.random().toString(36).slice(2);
const authUrl =
  "https://id.twitch.tv/oauth2/authorize?" +
  new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: scopes.join(" "), state, force_verify: "true" });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", redirectUri);
  const code = url.searchParams.get("code");
  if (!code || url.searchParams.get("state") !== state) {
    res.writeHead(400).end("Requête invalide.");
    return;
  }
  const tokenRes = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, grant_type: "authorization_code", redirect_uri: redirectUri }),
  });
  const body = (await tokenRes.json()) as { access_token?: string; refresh_token?: string; message?: string };
  if (!body.access_token) {
    res.writeHead(500).end("Échec : " + (body.message ?? "inconnu"));
    console.error(body);
    process.exit(1);
  }
  const dir = process.env.DATA_DIR ?? "data";
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "tokens.json"), JSON.stringify({ accessToken: body.access_token, refreshToken: body.refresh_token }, null, 2), { mode: 0o600 });
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" }).end("C'est bon ! Tu peux fermer cet onglet.");
  console.log("\nTokens enregistrés dans", path.join(dir, "tokens.json"));
  console.log("Ajoute aussi ces lignes à ton .env :\n");
  console.log(`TWITCH_BOT_ACCESS_TOKEN=${body.access_token}`);
  console.log(`TWITCH_BOT_REFRESH_TOKEN=${body.refresh_token}`);
  server.close();
});

server.listen(3000, () => {
  console.log("Ouvre ce lien et connecte-toi avec le compte du BOT :\n");
  console.log(authUrl + "\n");
});
