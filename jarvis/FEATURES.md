# FEATURES — JARVIS

Légende : ✅ faisable directement · ⚠️ faisable avec contournement ou condition · ❌ impossible tel quel (alternative proposée)
Phase = phase de la ROADMAP où la fonction est prévue.

## Cerveau et conversation
| Fonctionnalité | Faisabilité | Phase | Notes |
|---|---|---|---|
| Conversation naturelle en français, personnalité JARVIS | ✅ | 1 | Prompt de personnalité versionné + exemples |
| Mémoire court terme (contexte de session) | ✅ | 1 | |
| Historique complet des conversations | ✅ | 1 | PostgreSQL |
| Mémoire long terme et recherche sémantique | ✅ | 2 | pgvector + bge-m3 |
| Faits certains / supposés distingués | ✅ | 2 | Champ `statut` + `confiance` + `source` |
| Apprentissage des préférences | ✅ | 2 | Toujours confirmé par toi |
| Recherche web en temps réel | ✅ | 2 | SearXNG auto-hébergé (gratuit) |
| Reconnaître ses limites, proposer des alternatives | ⚠️ | 1→ | Mesurable grâce à l'étape de vérification ; jamais parfait à 100 % |

## iPhone
| Fonctionnalité | Faisabilité | Phase | Notes |
|---|---|---|---|
| App personnelle native | ⚠️ | 1 | Il faut un Mac (Xcode) pour compiler et installer ; compte développeur à 99 €/an recommandé |
| Conversation vocale naturelle | ✅ | 1 | STT/TTS sur l'iPhone ; mode « mains libres » |
| Notifications intelligentes | ⚠️ | 3 | APNs (compte payant) ou ntfy |
| Gestion des rendez-vous | ✅ | 2 | EventKit (calendrier iPhone/iCloud) |
| « Dis Siri, demande à JARVIS… » | ✅ | 2 | App Intents |
| Fonctionnement sans le PC | ⚠️ | 3 | Modèle Apple embarqué, capacités réduites |
| Analyse réseau depuis l'iPhone seul | ❌ | — | Interdit par iOS. Alternative : sonde réseau portable (Raspberry Pi) ou PC |

## Voiture (Audi A4 B9 + Road Top 12")
| Fonctionnalité | Faisabilité | Phase | Notes |
|---|---|---|---|
| Commandes et réponses vocales | ✅ | 4 | Via Siri/App Intents à travers CarPlay |
| App JARVIS visible dans CarPlay | ⚠️ | 4 | Soumis à l'entitlement Apple : à vérifier |
| Client JARVIS natif sur le Road Top (Android) | ⚠️ | 4 | Selon la possibilité d'installer des apps sur ce modèle |
| Reprise de conversation iPhone → voiture | ✅ | 4 | Même serveur, même identifiant de conversation |
| Lecture des données moteur (OBD-II) | ⚠️ | 4 | Dongle BLE ; lecture seule |
| Contrôle des fonctions de la voiture (clim, verrous…) | ❌ | — | Pas d'API ouverte sur une A4 2016. Seule la lecture OBD est réaliste |

## Windows
| Fonctionnalité | Faisabilité | Phase | Notes |
|---|---|---|---|
| Interface web complète | ✅ | 1 | |
| Gestion de projets | ✅ | 2 | |
| Développement informatique assisté | ✅ | 3 | Agent Developer + sandbox |
| Gestion de fichiers avec autorisations | ✅ | 3 | Liste blanche de dossiers |
| Exécution sécurisée de scripts | ✅ | 3 | Validation obligatoire, journalisation |

## Agent autonome
| Fonctionnalité | Faisabilité | Phase | Notes |
|---|---|---|---|
| « Organise ma journée de demain » | ✅ | 2 | Calendrier + tâches + détection de conflits ; propose, n'applique qu'après accord |
| « Crée-moi une app de dépenses » (conception → code → tests → correction) | ⚠️ | 3 | Faisable pour des apps web simples/moyennes, en grande partie grâce à Claude ; les apps iOS natives nécessitent le Mac |
| Délégation à des agents spécialisés | ✅ | 3 | |
| Vérification réelle des actions | ✅ | 1→ | Chaque outil renvoie une preuve |

## Création d'IA spécialisées
| Fonctionnalité | Faisabilité | Phase | Notes |
|---|---|---|---|
| Générer un agent (manifeste + prompt + outils) | ✅ | 5 | |
| Tester puis déployer en conteneur supervisé | ✅ | 5 | |
| Agent exportable chez un ami (paquet autonome) | ✅ | 5 | Installé sur *sa* machine, avec son accord |
| Agents de base : Developer, Personal, Home, Network, Automotive | ✅ | 3–5 | |

## Domotique et réseau
| Fonctionnalité | Faisabilité | Phase | Notes |
|---|---|---|---|
| TV, climatisation, prises, lumières | ⚠️ | 4 | Via Home Assistant, **si l'appareil est compatible** (Matter, API locale, IR via Broadlink…) |
| Diagnostic Wi-Fi / performances / anomalies (lecture seule) | ✅ | 5 | Depuis le PC ou une sonde, sur un réseau autorisé |
| Inventaire des appareils d'un réseau autorisé | ✅ | 5 | Uniquement avec autorisation explicite, consignée |
| Vérification de la configuration du routeur | ⚠️ | 5 | Lecture seule, avec les identifiants fournis par le propriétaire |

## Explicitement exclu (cf. SECURITY.md)
Accès non autorisé, contournement d'authentification, interception de trafic, modification non autorisée, installation cachée. Ces fonctions ne seront pas développées, même en option.
