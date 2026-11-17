# Bot Twitch IA

Bot de chat Twitch propulsé par Claude qui :

- 🎬 **crée des clips tout seul** quand il se passe un moment fort (pic d'activité + réactions du chat, validé par l'IA qui génère un titre), et sur `!clip` ;
- 📅 **lit le planning** de tes futurs lives (onglet *Planning* de Twitch) ;
- 📼 **redirige vers les rediffusions** quand quelqu'un a raté un live ;
- 🛡️ **intervient sur les insultes envers toi**, en laissant passer la taquinerie et le second degré ;
- 💬 **discute avec les viewers**.

## Installation

Prérequis : Node.js 20+.

```bash
cd twitch-bot
npm install
cp .env.example .env
```

1. **Clé Claude** : crée une clé sur https://console.anthropic.com/ et mets-la dans `ANTHROPIC_API_KEY`.
2. **App Twitch** : sur https://dev.twitch.tv/console, crée une application, ajoute `http://localhost:3000` comme *OAuth Redirect URL*, puis copie le Client ID et le Client Secret dans `.env`.
3. **Compte du bot** : crée un compte Twitch dédié au bot (ex. `monbot_ia`), mets son pseudo dans `TWITCH_BOT_USERNAME` et ta chaîne dans `TWITCH_CHANNEL`.
4. **Token du bot** : lance `npm run auth`, ouvre le lien et **connecte-toi avec le compte du bot**. Copie les deux tokens affichés dans `.env`. (Le bot les rafraîchit tout seul ensuite.)
5. **Mets le bot modérateur** : dans ton chat, tape `/mod monbot_ia`. Sans ça il ne pourra ni supprimer de message ni timeout.
6. **Remplis ton planning Twitch** (Tableau de bord créateur → Paramètres → Chaîne → Planning) : c'est là que le bot lit tes prochains lives.
7. Lance : `npm start`

> Conseil : laisse `MODERATION_DRY_RUN=true` pour tes premiers lives. Le bot affiche dans la console ce qu'il aurait sanctionné, sans toucher au chat. Passe-le à `false` quand le résultat te convient.

## Commandes du chat

| Commande | Effet |
|---|---|
| `@monbot_ia <question>` ou `!ia <question>` | Discute avec le bot |
| `!planning` | Prochains lives |
| `!rediff` | Lien de la dernière rediffusion |
| `!clip` | Modo/streamer : clip immédiat. Viewers : vote (3 viewers en 30 s par défaut) |

Le bot répond aussi sans mention aux questions du type « c'est quand le prochain live ? » ou « j'ai raté le live, y a une rediff ? ». Désactivable avec `ANSWER_KEYWORD_QUESTIONS=false`.

Les modos et VIP peuvent aussi demander en langage naturel : « @monbot_ia clip ça ! ».

## Fonctionnement

### Clips autonomes
Toutes les 5 s, le bot compare le nombre de messages des 15 dernières secondes à la moyenne habituelle du chat. Si ça explose (×2,5 par défaut) ou si le chat s'emballe en réactions (KEKW, POG, mdr, CLIP…), Claude lit les 45 dernières secondes de chat et décide si c'est un vrai moment fort (pas un raid ni du spam). Si oui : clip des 30 dernières secondes, titre généré, lien posté dans le chat. Tous les clips sont enregistrés dans `data/clips.jsonl`.

### Modération
1. Un pré-filtre local (gratuit) repère les messages contenant un mot potentiellement insultant, même déguisé (`c0nnnnard`, `fdp`, accents, leet speak…).
2. Seuls ces messages partent chez Claude, avec le contexte du chat et l'historique de l'auteur. Il détermine **qui est visé** (toi, le bot, un viewer, personne) et **le ton** (humour ou hostile).
3. Sanction :
   - taquinerie, juron d'exclamation (« putain le clutch ! ») → rien ;
   - insulte légère → avertissement ;
   - insulte claire → message supprimé + avertissement ;
   - récidive (plus de 2 avertissements en 1 h) → timeout de 10 min ;
   - haine, propos discriminatoires, menaces → suppression + timeout immédiat.

Les modos, le streamer et les pseudos listés dans `MODERATION_TRUSTED_USERS` ne sont jamais sanctionnés. `MODERATION_PROTECT_VIEWERS=true` protège aussi les viewers entre eux.

> Le pré-filtre fait que les insultes sans aucun mot du lexique (sarcasme pur) ne sont pas analysées. Tu peux enrichir la liste `LEXICON` dans `src/features/moderation.ts`.

## Structure

```
src/
  index.ts              connexion au chat et aiguillage des messages
  config.ts             lecture du .env
  twitch/api.ts         API Twitch Helix (clips, planning, VOD, modération, tokens)
  ai/claude.ts          appels à Claude (JSON validé + discussion avec outils)
  features/autoclip.ts  détection des moments forts + clips
  features/moderation.ts
  features/assistant.ts discussion, planning, rediffs, commandes
scripts/auth.ts         récupération du token Twitch du bot
test/                   tests (npm test)
```

## Coûts

Le bot n'appelle Claude que pour : les messages qui lui sont adressés, les messages qui passent le pré-filtre d'insultes, et les pics d'activité. Le reste du chat ne coûte rien. Les cooldowns (`CHAT_USER_COOLDOWN_SEC`, `CHAT_GLOBAL_COOLDOWN_SEC`, `AUTOCLIP_COOLDOWN_SEC`) limitent les abus.
