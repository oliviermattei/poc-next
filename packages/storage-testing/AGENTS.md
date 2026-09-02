# packages/storage-testing — règles locales

**Outil de développement du port `Storage`. Ce n'est pas un fournisseur.**

C'est la phrase la plus importante de ce fichier, et elle est opposable : ADR 008
livre **une seule implémentation par port**, et cette implémentation est S3 / R2
(`packages/adapters/s3`). Supabase Storage et les autres restent au cimetière du
PRD. Rien de ce que contient ce package ne les rend légitimes — parce que rien
ici ne parle à un service tiers.

| Outil | Ce qu'il fait | Quand |
|---|---|---|
| `createLocalDiskStorage` | présigne vers **notre propre origine**, écrit sous un dossier injecté et ignoré par git | en développement, sur demande explicite : `STORAGE_LOCAL_DIRECTORY` (`docs/reliability.md` §2) |

**C'est un opt-in, pas un repli.** Une absence de seau ne suffit pas à le
déclencher : elle ferait écrire sur le disque d'un déploiement en rendant
`{ok:true}`, ce qu'aucun appelant ne peut distinguer d'un vrai stockage. Sans
seau et sans dossier, le montage échoue en nommant les variables. C'est la règle
de `EMAIL_LOCAL_CAPTURE` et de `OAUTH_LOCAL_PROVIDER`, et elle a le même motif.

## L'URL présignée locale a les trois propriétés d'une vraie

Un outil de développement qui accepterait n'importe quel `PUT` sur n'importe
quelle clé apprendrait la mauvaise leçon au prochain agent. Celui-ci signe :

1. **elle ne dure pas** — l'échéance est dans la charge signée, et vérifiée ;
2. **elle ne vaut que pour la clé, le type et la taille qu'elle nomme** — les
   quatre sont dans la charge ;
3. **elle ne permet pas d'écrire hors du dossier**.

Le secret est **tiré au hasard à la construction** quand il n'est pas fourni :
une URL présignée n'a pas à survivre au processus qui l'a émise, et un secret
par défaut écrit en dur serait un secret publié.

## Pourquoi l'URL reste sur notre origine

`apps/web/lib/security-headers.ts` émet `connect-src 'self'` et
`config/security.ts` livre la liste vide. Un `PUT` du navigateur vers le domaine
d'un seau réel est donc **refusé** tant que ce domaine n'est pas déclaré là-bas.
L'état livré du dépôt, lui, présigne vers `/api/modules/storage/local-upload` :
un clone téléverse sans qu'aucune source n'entre dans la politique. C'est écrit
dans l'ADR 032, rappelé dans `.env.example`, et depuis la revue de s18
`apps/web/lib/storage-config.ts` **refuse de démarrer** quand un seau réel est
configuré sans que son origine soit déclarée.

## `write` écrit sans signature, et passe par la même frontière

C'est la voie de la **promotion** (ADR 033) : le serveur y pose des octets qu'il
vient de vérifier. Elle ne demande ni signature ni échéance — l'appelant est le
serveur, pas le navigateur —, mais la clé traverse `localObjectPath` comme
toutes les autres : une clé qui sort du dossier n'écrit rien, et le cas est
mesuré.

## Imports autorisés

- `@repo/ports` pour le port `Storage` et sa forme de résultat ;
- `node:crypto`, `node:fs/promises` et `node:path` — c'est le seul endroit du
  couple port/adapter qui touche au disque ;
- `@repo/typescript-config` pour la configuration du compilateur ;
- `vitest` dans les fichiers de test.

Aucun SDK, aucun client HTTP.

## Ne doit jamais contenir

- **d'implémentation qui parle à un service tiers** : ce serait un second
  adapter, et ADR 008 n'en livre qu'un ;
- de lecture de `NODE_ENV` ni de `process.env` : le point d'accès unique est
  `@repo/config`, et le choix du stockage se fait par injection ;
- de chemin d'écriture deviné (`process.cwd()`, racine du dépôt) : le dossier
  est **injecté**, comme celui de la capture d'emails ;
- de règle métier : cet outil ne décide ni de ce qu'on téléverse, ni de qui a le
  droit de le lire.

## Tests

`src/storage-testing.test.ts`, à côté du code qu'il couvre (`pnpm test`).

**Ce qui a été prouvé par mutation**, sur les trois neutralisations essayées :

| Neutralisation | Cas rouges |
|---|---|
| vérification de l'échéance retirée de `handleUpload` | 1 |
| clé retirée de la charge signée | 1 |
| garde des segments retirée de `localObjectPath` | 1 |
| vérification du chemin **résolu** retirée | **0** — voir ci-dessous |

La dernière ligne est écrite parce qu'elle est vraie, pas malgré cela. La
vérification du chemin résolu n'est **pas atteignable** tant que la garde des
segments refuse `..` et tout caractère hors de `[A-Za-z0-9._-]` : c'est le filet
d'une garde active, exactement comme le `basename` de `@repo/mailer-testing`.
Elle servira le jour où quelqu'un élargira le jeu de caractères. Une garde dont
on croit qu'elle mord alors qu'elle ne mord pas est pire qu'une garde absente.
