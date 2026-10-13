# ADR 032 — L'écriture va directement au stockage, la lecture passe par l'application

- Status: accepted
- Date: 2026-09-01

Un téléversement ne doit pas transiter par le serveur applicatif (mémoire, temps d'exécution, limite de corps de la plateforme — 4,5 Mo chez Vercel), et un fichier rattaché à une organisation ne doit être lisible que par ses membres.

**L'asymétrie est la décision.** L'écriture va directement au stockage : le serveur juge type et taille annoncés, fabrique la clé, émet une URL présignée, puis les octets vont du navigateur au fournisseur. La lecture passe par une route du module `storage` qui relit l'appartenance à chaque requête et sert les octets elle-même ; le port `Storage` n'expose aucune présignature de lecture. Le contenu réel est vérifié à la confirmation, en relisant l'objet par le port (ADR 033). En mode local, la présignature vise notre propre origine (`/storage/local-upload`, signée HMAC avec échéance), si bien que l'état livré téléverse sans qu'aucune source n'entre dans `config/security.ts`. Avec un vrai seau, son origine entre dans le seul champ `connect` de `config/security.ts` : c'est un geste du propriétaire du projet, et le dépôt n'y ajoute aucune source par défaut.

## Considered options

- **URL présignée de lecture, et le seau dans `img-src`** — rejeté : ouvre la politique de sécurité du contenu à un domaine tiers, et une URL présignée est une capacité détachée de l'appartenance — valide après le départ du membre, transmissible telle quelle. Une durée courte réduit la fenêtre, elle ne change pas la nature.
- **Tout par l'application, téléversement compris** — rejeté : condamne tout fichier volumineux à la limite de corps de la plateforme.
- **Un jeton signé repassé à la confirmation** — rejeté : la forme de la clé suffit ; elle est fabriquée sous le préfixe du périmètre de l'appelant, et la confirmation vérifie ce préfixe.

## Consequences

Les octets d'un avatar traversent l'application à la lecture, en `private, no-store`. L'URL de lecture porte un jeton de fraîcheur (`&v=`) dérivé de la dernière écriture, sans quoi un remplacement ne change pas l'attribut `src` et le navigateur garde l'ancienne image. Un futur module de fichiers volumineux rouvrira la question par un cache HTTP validé par `ETag`, pas en présignant la lecture.

Un objet téléversé puis jamais confirmé n'est nommé par aucune ligne, donc connu d'aucune purge : la réponse est une règle de cycle de vie sur le seau, geste d'exploitation décrit dans `.env.example` et `packages/modules/storage/AGENTS.md`.
