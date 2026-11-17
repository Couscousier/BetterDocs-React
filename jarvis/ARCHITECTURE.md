# ARCHITECTURE — JARVIS

## 1. La contrainte « tout passe par mon iPhone, en local »

C'est la décision qui structure tout le reste. Voici ce que l'iPhone **peut** et **ne peut pas** faire.

### Ce qu'un iPhone peut faire seul (sans serveur)
- Reconnaissance vocale sur l'appareil (framework Speech / SpeechAnalyzer), hors ligne.
- Synthèse vocale de bonne qualité (voix « Premium » / « Améliorée » d'iOS).
- Petit LLM embarqué : **Apple Foundation Models** (~3 milliards de paramètres, iOS 26+, iPhone compatible Apple Intelligence). Il gère bien la reformulation, le résumé, l'extraction et l'appel d'outils simples, mais pas le développement d'applications ni le raisonnement long.
- Calendrier, rappels et contacts via EventKit/Contacts (avec ton autorisation).
- Siri, App Intents et Raccourcis : « Dis Siri, demande à JARVIS… ».
- Notifications locales.
- Contrôle domotique via HomeKit (si les appareils sont compatibles HomeKit/Matter).

### Ce qu'un iPhone ne peut PAS faire (limites imposées par iOS)
| Besoin | Pourquoi c'est bloqué |
|---|---|
| Faire tourner un LLM capable de coder / de piloter des agents | Mémoire (8 Go max partagés) et thermique : au mieux un modèle de 3 à 8 milliards de paramètres, lent et limité |
| Tourner en permanence en arrière-plan (surveillance, initiatives) | iOS suspend les apps ; l'arrière-plan est très encadré |
| Analyser un réseau Wi-Fi (scan d'appareils, table ARP, ports) | Pas de sockets bruts, pas d'accès ARP ; seulement Bonjour/mDNS avec la permission « Réseau local » |
| Exécuter du code généré, Docker, des tests | Interdit par le sandbox iOS |
| Héberger une base de données partagée avec PC et voiture | Possible localement, mais pas comme cerveau central toujours joignable |

### Conclusion et recommandation
**L'iPhone est l'interface et le « système nerveux » personnel. Le cerveau est un serveur chez toi.**
« Local » veut dire : **tes données restent chez toi** (PC + iPhone), reliées par un **tunnel privé chiffré**. Rien ne transite par un serveur tiers, sauf les appels Claude explicitement autorisés.

Option forte à envisager : un **mini-PC toujours allumé** (~10 W) qui porte la mémoire, l'orchestrateur et Home Assistant. Le PC RTX ne servirait alors que de « moteur de calcul » pour les gros modèles. Ton PC de jeu n'aurait plus besoin de tourner 24 h/24 (voir §6, coûts).

## 2. Vue d'ensemble

```
                      ┌──────────────────────────────────────────┐
                      │        iPhone — App JARVIS (SwiftUI)     │
                      │ Voix (STT/TTS on-device) · Chat · Notifs │
                      │ EventKit · HomeKit · App Intents/Siri    │
                      │ Mode dégradé : Apple Foundation Models   │
                      │ CarPlay (selon entitlement, voir §5)     │
                      └───────────────┬──────────────────────────┘
                                      │ Tailscale (WireGuard), TLS + jeton d'appareil
                                      ▼
┌───────────────────────────────── SERVEUR MAISON ─────────────────────────────────┐
│                                                                                   │
│  ┌──────────────┐   ┌──────────────────────────────────────────────────────────┐  │
│  │ API Gateway  │──▶│  JARVIS Core (Python · FastAPI)                          │  │
│  │ auth, quotas │   │  ├─ Orchestrateur d'agents (boucle plan → outils → vérif)│  │
│  │ journalisat. │   │  ├─ Routeur de modèles (local d'abord, Claude si besoin) │  │
│  └──────────────┘   │  ├─ Gestionnaire de mémoire (court / long terme / faits) │  │
│                     │  ├─ Moteur d'initiatives (planificateur, alertes)        │  │
│                     │  └─ Policy Engine (règles de sécurité — lecture seule)   │  │
│                     └────────┬───────────────────────┬─────────────────────────┘  │
│                              │ MCP (outils)          │                            │
│        ┌─────────────────────┼───────────────────────┼──────────────────┐         │
│        ▼                     ▼                       ▼                  ▼         │
│  ┌───────────┐   ┌───────────────────┐   ┌───────────────────┐  ┌──────────────┐ │
│  │ Ollama /  │   │ PostgreSQL        │   │ Agents spécialisés│  │ Home         │ │
│  │ llama.cpp │   │ + pgvector        │   │ (conteneurs)      │  │ Assistant    │ │
│  │ Qwen3 etc.│   │ mémoire + journal │   │ Developer/Network │  │ domotique    │ │
│  │ (RTX 5070)│   └───────────────────┘   │ Home/Auto/Personal│  └──────────────┘ │
│  └───────────┘                           └───────────────────┘                   │
│  ┌───────────┐   ┌───────────────────┐   ┌───────────────────┐                   │
│  │ Whisper   │   │ SearXNG           │   │ Sandbox code      │                   │
│  │ (STT GPU) │   │ recherche web     │   │ (Docker isolé)    │                   │
│  │ Kokoro TTS│   │ auto-hébergée     │   │ tests, builds     │                   │
│  └───────────┘   └───────────────────┘   └───────────────────┘                   │
└───────────────────────────────────────────────────────────────────────────────────┘
          ▲                                                        │
          │ Interface web complète (Windows, navigateur)           │ API Claude (optionnelle,
          │                                                        ▼ plafonnée, journalisée)
```

## 3. Composants

### 3.1 JARVIS Core — Python 3.12 + FastAPI
- **Pourquoi Python** : c'est l'écosystème IA de référence (Ollama, faster-whisper, pgvector, SDK Anthropic, MCP). TypeScript sert à l'interface web.
- **Orchestrateur** : une boucle agent maison, simple et testable : *comprendre → planifier → appeler des outils → vérifier le résultat → répondre*. L'étape « vérifier » est obligatoire pour toute action, pour respecter l'exigence « ne jamais prétendre que c'est fait ».
- **Protocole d'outils : MCP (Model Context Protocol)**. C'est un standard ouvert : chaque outil (calendrier, domotique, fichiers, réseau…) est un petit serveur MCP isolé. Un agent spécialisé = un prompt + un ensemble d'outils MCP + un espace mémoire. C'est la base de la fonction « créer de nouvelles IA ».
- Alternatives étudiées : LangGraph (puissant mais lourd et instable dans ses API), CrewAI (trop « magique » pour un système qui doit être audité), Claude Agent SDK (excellent pour l'agent Developer, mais lié à Claude, donc utilisé en complément et pas comme socle).

### 3.2 Modèles — stratégie hybride
| Rôle | Modèle recommandé | Où | Coût |
|---|---|---|---|
| Conversation courante, outils, mémoire | **Qwen3 14B** (Q4, ~9 Go de VRAM) ou **Qwen3 30B-A3B** (MoE, rapide) | PC, Ollama | Gratuit |
| Embeddings (recherche sémantique) | **bge-m3** (multilingue, bon en français) | PC | Gratuit |
| Reconnaissance vocale | Apple Speech (iPhone) / **faster-whisper large-v3-turbo** (PC) | Les deux | Gratuit |
| Synthèse vocale | Voix iOS Premium / **Kokoro** ou **Piper** (voix FR) | Les deux | Gratuit |
| Mode hors ligne iPhone | **Apple Foundation Models** | iPhone | Gratuit |
| Développement d'apps, raisonnement difficile, création d'agents | **Claude** (API) | Cloud | À l'usage, plafonné |

16 Go de VRAM : un seul modèle de ~14B reste chargé en permanence. Whisper et les embeddings sont chargés à la demande. Les modèles de 70B ne sont pas réalistes sur cette carte avec une vitesse confortable.

**Routeur de modèles** : il commence toujours par le modèle local. Il bascule vers Claude seulement si (a) la tâche est classée « complexe » (code multi-fichiers, conception d'agent) ou (b) le modèle local échoue à la vérification. Chaque bascule est journalisée, avec un plafond mensuel strict.

### 3.3 Mémoire
Une seule base : **PostgreSQL 16 + pgvector**. C'est éprouvé, sauvegardable, et ça évite d'empiler les bases.

| Couche | Stockage | Rôle |
|---|---|---|
| Court terme | Fenêtre de contexte + résumé glissant de la session | Fil de la conversation en cours |
| Épisodique | Table `conversations`/`messages` + résumés vectorisés | « De quoi on a parlé mardi ? » |
| Sémantique (faits) | Table `facts` : sujet, contenu, **source**, **niveau de confiance**, **statut** (`confirmé` / `déduit` / `obsolète`), date | Préférences, infos personnelles. Distingue le **certain** du **supposé** |
| Projets | Table `projects` + documents indexés (RAG) | Mémoire de travail par projet |
| Procédurale | Spécifications des agents, routines apprises | Savoir-faire |

- **RAG** : recherche hybride (vecteurs + plein texte PostgreSQL), puis reranking. Le contexte injecté cite ses sources.
- **Apprentissage des préférences** : JARVIS *propose* un fait déduit (« Tu sembles préférer les réunions le matin ? ») et ne le passe en `confirmé` qu'après ton accord ou des observations répétées. Tu peux consulter, corriger et effacer la mémoire.
- **Redis** : pas nécessaire au départ. On l'ajoutera seulement si une file de tâches devient nécessaire (la phase 3 utilisera d'abord la table de tâches PostgreSQL).

### 3.4 Synchronisation multi-appareils
- **Source de vérité unique = le serveur.** iPhone, web Windows et voiture sont des clients.
- Conversations diffusées en temps réel via **WebSocket**. Chaque conversation a un identifiant : on la commence sur l'iPhone et on la reprend dans la voiture ou sur le PC.
- **Hors ligne** : l'iPhone met les messages en file d'attente (SwiftData) et les synchronise au retour de la connexion. En attendant, le modèle embarqué répond aux demandes simples, et ses réponses sont marquées « mode local ».
- **Accès hors de chez toi** : **Tailscale**, gratuit pour un usage personnel. Le réseau privé est chiffré, aucun port n'est ouvert sur la box, et l'iPhone voit le serveur comme s'il était sur le même réseau. Alternative 100 % auto-hébergée : WireGuard + Headscale.

### 3.5 Notifications et initiatives
- Le moteur d'initiatives tourne côté serveur (tâches planifiées) : rendez-vous imminent, conflit d'agenda, tâche oubliée, équipement en panne.
- Envoi par **APNs** (le service de notifications d'Apple, qui exige le compte Apple Developer) ou, en alternative sans compte payant, **ntfy** auto-hébergé.
- Chaque type d'initiative peut être activé ou désactivé, avec des heures de silence et un niveau d'insistance.

### 3.6 Agents spécialisés et « création d'IA »
Un agent JARVIS est défini par un **manifeste** versionné (YAML) :
```yaml
name: jarvis-network
description: Diagnostic réseau défensif, lecture seule
model: local:qwen3-14b         # ou cloud:claude si autorisé
system_prompt: prompts/network.md
tools: [net.ping, net.mdns_discover, net.speedtest, net.router_status_readonly]
permissions: { network: lan_only, filesystem: none, actions_requiring_approval: ["*write*"] }
memory_namespace: network/<site>
supervisor: jarvis-core
```
**Créer une nouvelle IA** = JARVIS (avec l'agent Developer) rédige le manifeste, le prompt et, si besoin, de nouveaux outils MCP. Ensuite :
1. Le code généré passe par la **sandbox** : conteneur sans réseau, puis tests automatiques.
2. Le **Policy Engine** vérifie que les permissions demandées sont acceptables.
3. **Tu valides** le manifeste (affiché lisiblement).
4. Déploiement en conteneur isolé, supervisé par JARVIS (santé, journaux, révocation).

Une IA créée pour un ami est **exportable** : un paquet Docker Compose autonome, avec sa propre mémoire, à installer sur *sa* machine avec *son* accord. Aucune dépendance cachée vers ton serveur.

### 3.7 Interface Windows
- Interface web (**React + TypeScript**) servie par le Core et accessible sur le PC. Elle offre chat, mémoire, projets, journaux, validation des actions et gestion des agents.
- Les actions sur fichiers et scripts Windows passent par un **agent local Windows** distinct, aux permissions minimales : une liste blanche de dossiers et une validation des commandes.

## 4. Matériel et déploiement
- **PC Windows (RTX 5070 Ti, 32 Go)** : Ollama natif Windows (meilleur accès GPU) + **Docker Desktop/WSL2** pour PostgreSQL, Core, SearXNG, Home Assistant et la sandbox.
- 32 Go de RAM : suffisant, mais il faudra surveiller la consommation si tu joues pendant que JARVIS tourne (le modèle occupe la VRAM).
- Évolution recommandée : **mini-PC** toujours allumé (N100/N150, 16 Go) pour le Core, la base et Home Assistant. Le PC RTX est réveillé à la demande (Wake-on-LAN) pour les gros modèles.

## 5. Voiture — Audi A4 B9 + Road Top 12"
- Le Road Top est un écran **Android** qui reçoit l'iPhone en **CarPlay sans fil**.
- **Piste A — CarPlay** : une app tierce n'apparaît dans CarPlay qu'avec un *entitlement* Apple accordé par catégorie (audio, communication, navigation, etc.). Apple a ouvert une catégorie pour les apps conversationnelles vocales, **à vérifier précisément au moment du développement**, car les règles évoluent. Même sans app CarPlay dédiée, **Siri + App Intents fonctionnent en voiture** : « Dis Siri, demande à JARVIS… » donne une réponse vocale. C'est la solution la plus fiable au départ.
- **Piste B — Application Android sur le Road Top** : l'écran étant sous Android, on peut y installer un client JARVIS natif connecté au serveur via Tailscale (partage de connexion de l'iPhone). Cette piste n'a pas besoin d'autorisation d'Apple et offre une interface plein écran adaptée à la conduite. À confirmer selon le modèle exact (accès au Play Store / installation d'APK).
- **Données du véhicule** : un dongle **OBD-II Bluetooth LE** (ex. OBDLink CX, ~80 €) permet de lire les codes défauts, la température, la tension batterie, etc. **Lecture seule** : aucune écriture dans les calculateurs, par sécurité.
- Règle absolue : en conduite, **voix uniquement**, réponses courtes, aucune action qui demande de regarder l'écran.

## 6. Coûts estimés
| Poste | Coût | Obligatoire ? |
|---|---|---|
| Logiciels (Ollama, Qwen, PostgreSQL, Home Assistant, SearXNG, Whisper, Kokoro, Tailscale perso) | 0 € | — |
| **Apple Developer Program** | **99 €/an** | Quasi indispensable : sans lui, l'app expire tous les 7 jours, sans notifications push, sans CarPlay, sans TestFlight |
| API Claude | ~0 à 20 €/mois selon l'usage, **plafond configurable** | Optionnel |
| Électricité du PC 24 h/24 (~80–120 W au repos) | ~15–25 €/mois | Évitable avec un mini-PC |
| Mini-PC toujours allumé | ~150–250 € une fois | Recommandé |
| Dongle OBD-II BLE | ~30–80 € une fois | Pour JARVIS Automotive |

## 7. Difficultés majeures identifiées
1. **Limites d'iOS** (arrière-plan, réseau, exécution de code) : contournées en plaçant le cerveau sur le serveur.
2. **CarPlay** : dépend d'une autorisation Apple ; Siri et le client Android servent de solutions de repli.
3. **Qualité des LLM locaux** pour les tâches agentiques longues : routeur hybride + vérification systématique.
4. **Fiabilité de la vérification d'action** : chaque outil doit renvoyer une preuve (état relu, code retour, capture). Sans preuve, on considère que l'action a échoué.
5. **Sécurité des agents qui génèrent du code** : sandbox, Policy Engine immuable, validation humaine.
6. **Mémoire qui « hallucine » des préférences** : faits typés avec confiance et source, confirmation explicite.
7. **Charge de maintenance** sur plusieurs années : architecture modulaire (MCP), tests automatisés, versionnement des manifestes.
