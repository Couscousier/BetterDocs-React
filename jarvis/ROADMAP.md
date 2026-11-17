# ROADMAP — JARVIS

Principe : **chaque phase livre quelque chose d'utilisable, testé et documenté**. Une fonction n'est déclarée « fonctionnelle » qu'après un test qui le prouve. Toute simulation ou maquette est signalée comme telle.

Durées indicatives pour un développement à temps partiel avec mon aide.

## Phase 0 — Fondations (1 semaine)
- Dépôt dédié `jarvis` (monorepo : `server/`, `ios/`, `web/`, `agents/`, `docs/`).
- Installation : Ollama + Qwen3 14B, Docker Desktop/WSL2, PostgreSQL+pgvector, Tailscale sur le PC et l'iPhone.
- Intégration continue : lint + tests automatiques à chaque commit.
- ✔ **Critère** : depuis l'iPhone en 4G, `curl` vers le serveur via Tailscale répond ; Ollama répond en moins de 2 s pour une phrase courte.

## Phase 1 — PROTOTYPE v0.1 « JARVIS parle et se souvient » (2–3 semaines)
**Objectif** : un vrai JARVIS minimal, utilisable au quotidien.
- Serveur FastAPI : endpoint de chat en streaming (WebSocket), personnalité JARVIS, historique en PostgreSQL.
- Boucle agent avec **2 outils réels** : heure/date et recherche web (SearXNG).
- Interface web Windows simple : chat + historique.
- **App iPhone SwiftUI** : chat texte + **voix** (reconnaissance et synthèse sur l'appareil), conversations synchronisées avec le web.
- Policy Engine v0 (niveaux 0/1 uniquement) + journal des actions.
- ✔ **Critères** : tests automatisés du serveur (pytest) ; je commence une conversation sur l'iPhone et la termine sur le PC ; la recherche web cite ses sources ; chaque appel d'outil apparaît dans le journal.

> Prérequis côté toi : **un Mac avec Xcode** (même ancien, ou un Mac mini d'occasion) pour compiler l'app iPhone, et idéalement le compte Apple Developer. Sans Mac, la phase 1 fonctionne via l'interface web sur l'iPhone (PWA), et l'app native est reportée.

## Phase 2 — Mémoire et organisation (3–4 semaines)
- Mémoire long terme : faits avec confiance/source, recherche sémantique (bge-m3), écran « Ce que JARVIS sait de moi ».
- Calendrier (EventKit côté iPhone exposé comme outil) : « organise ma journée de demain » avec détection de conflits ; propositions validées avant écriture.
- Siri / App Intents : « Dis Siri, demande à JARVIS… ».
- Gestion de projets basique.
- ✔ **Critères** : jeu de tests de rappel mémoire (≥ 90 % des faits retrouvés sur un jeu de 50 questions) ; création de RDV vérifiée en relisant le calendrier.

## Phase 3 — Agent autonome et développeur (4–6 semaines)
- Routeur de modèles local → Claude, avec plafond mensuel.
- Sandbox Docker d'exécution de code.
- Agent **JARVIS Developer** : « crée-moi une app de dépenses » → spec → code → tests → corrections → app web lancée et démontrée.
- Notifications et moteur d'initiatives configurable (RDV imminent, tâche oubliée).
- Agent local Windows (fichiers en liste blanche, scripts validés).
- Policy Engine complet (niveaux 2/3, validation sur l'iPhone, arrêt d'urgence).
- ✔ **Critères** : l'app de dépenses générée passe ses propres tests ; une tentative d'injection de prompt du jeu de tests ne déclenche aucune action sensible.

## Phase 4 — Maison et voiture (4 semaines)
- Home Assistant + agent **JARVIS Home** (TV, clim, lumières selon compatibilité).
- Voiture : Siri/CarPlay ; étude puis client Android sur le Road Top ; dongle OBD-II et agent **JARVIS Automotive** (lecture seule).
- Interface « conduite » : voix seule, réponses courtes.
- ✔ **Critères** : chaque commande domotique est vérifiée par relecture de l'état ; test réel en voiture.

## Phase 5 — Usine à IA et JARVIS Network (6+ semaines)
- Format de manifeste d'agent, générateur d'agents, revue + validation, déploiement supervisé, export autonome « pour un ami ».
- Agent **JARVIS Network** (défensif, lecture seule, registre des autorisations) et sonde portable optionnelle (Raspberry Pi).
- ✔ **Critère** : création de bout en bout d'un nouvel agent à partir d'une demande vocale, testé puis déployé après validation.

## Phase 6+ — Évolution continue
Mini-PC toujours allumé, modèles locaux plus puissants à mesure qu'ils sortent, amélioration de la voix (voix personnalisée), tableaux de bord, nouveaux agents.

---

## Décisions à valider avant de démarrer
1. **Architecture « iPhone = interface, cerveau = serveur maison via tunnel privé »** : OK ?
2. As-tu accès à **un Mac** (indispensable pour une vraie app iPhone) ?
3. OK pour le **compte Apple Developer (99 €/an)** ?
4. OK pour un **budget API Claude plafonné** (proposition : 10 €/mois au départ, 0 € possible en tout local, mais l'agent Developer sera nettement moins capable) ?
5. Le PC peut-il rester allumé, ou préfères-tu prévoir un **mini-PC** ?
6. **Dépôt dédié** `jarvis` plutôt que ce dépôt Gatsby ?
