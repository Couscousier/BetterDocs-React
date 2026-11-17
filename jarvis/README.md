# Projet JARVIS

Une plateforme d'intelligence artificielle personnelle, privée et évolutive. Elle se pilote depuis l'iPhone et son cerveau tourne chez moi.

> **État actuel : phase d'étude, AUCUN code écrit.**
> Ce dossier contient l'analyse et l'architecture proposées. Le développement commencera seulement après validation.

## Documents

| Document | Contenu |
|---|---|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Faisabilité, contrainte « tout via l'iPhone en local », architecture cible, comparatif des technologies, coûts |
| [FEATURES.md](./FEATURES.md) | Fonctionnalités avec leur niveau de faisabilité réel (✅ faisable / ⚠️ avec contournement / ❌ impossible tel quel) |
| [SECURITY.md](./SECURITY.md) | Modèle de menace, protections de JARVIS lui-même, règles du module Network |
| [ROADMAP.md](./ROADMAP.md) | Phases de développement, premier prototype, critères de validation |

## Résumé en 30 secondes

- **L'iPhone est la porte d'entrée unique** : application SwiftUI native avec la voix, les notifications, le calendrier et Siri/CarPlay.
- **Le cerveau tourne sur ton PC** (RTX 5070 Ti) : LLM local, mémoire, agents et outils. L'iPhone y accède via un **tunnel privé chiffré (Tailscale/WireGuard)**, sans aucun port ouvert sur Internet ni cloud intermédiaire.
- **Le cloud (Claude) n'intervient qu'à la demande** pour les tâches où il apporte une vraie valeur (gros développements, raisonnement difficile), avec un plafond de dépenses.
- **Mode dégradé sur l'iPhone** : si le PC est éteint ou injoignable, un petit modèle embarqué (Apple Foundation Models, sur l'appareil) assure les fonctions simples, et le reste est synchronisé plus tard.
- **Sécurité** : moindre privilège, validation humaine des actions sensibles, et un moteur de règles que JARVIS ne peut pas modifier.

## Emplacement

Ce dossier vit provisoirement dans le dépôt `BetterDocs-React`, un site Gatsby sans rapport avec JARVIS. Il est recommandé de créer un dépôt dédié `jarvis` avant de commencer le développement (voir ROADMAP, phase 0).
