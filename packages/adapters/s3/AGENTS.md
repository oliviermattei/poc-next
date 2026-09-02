# packages/adapters/s3 — règles locales

**L'unique implémentation livrée du port `Storage`** (ADR 008) — S3 et toute API
compatible : Cloudflare R2, MinIO, DigitalOcean Spaces. Il n'y en aura pas de
seconde : le PRD tranche « une seule implémentation livrée ». Le stockage sur
disque de `@repo/storage-testing` est un **outil de développement**, pas un
fournisseur : rien là-bas ne parle à un service tiers.

C'est le second adapter du dépôt, et il suit le gabarit de
`packages/adapters/resend`, à la lettre :

- toutes les collaborations **injectées** (journal, sommeil, hasard) ;
- **aucune méthode ne lève** ; l'échec est une valeur (`docs/reliability.md` §2) ;
- délai d'attente explicite, reprises en recul exponentiel dispersé et plafonné,
  **sur erreurs transitoires uniquement** (§3) ;
- le journal ne porte que ce que `StorageLogRecord` autorise, et le message du
  fournisseur est assaini (`docs/security.md` §5).

## Ce qui a été relevé dans les paquets installés, pas dans la documentation

Quatre constats décident du code de ce package. Ils viennent d'une **exécution**
contre `@aws-sdk/client-s3@3.1123.0` et `@aws-sdk/s3-request-presigner@3.1123.0` ;
une montée de version doit les revérifier.

| Constat | Conséquence ici |
|---|---|
| le gestionnaire de requêtes par défaut parle `node:http` | `FetchHttpHandler` est **imposé**, en production comme en test : sans lui, le régime de doublure du dépôt (« la doublure remplace le réseau, jamais le SDK ») ne voit rien du tout, et ce qui serait éprouvé ne serait pas ce qui s'exécute |
| `getSignedUrl` ne touche pas le réseau | la présignature n'a ni délai à borner, ni reprise à faire. Le `try` reste : un port ne lève pas, et le calcul peut échouer sur des options incohérentes |
| `signableHeaders: new Set(['content-type','content-length'])` produit `X-Amz-SignedHeaders=content-length;content-type;host` | l'URL rendue ne vaut **ni** pour un autre type, **ni** pour une autre taille, **ni** pour une autre clé — celle-ci est déjà dans le chemin signé |
| le SDK a sa propre politique de reprise | `maxAttempts: 1` la coupe. Deux politiques superposées multiplient les essais sans que personne ne l'ait décidé, et `StorageError.attempts` deviendrait faux |

Nuance mesurée sur le délai : `FetchHttpHandler({ requestTimeout })` **borne
déjà** l'attente. Retirer la course de `withTimeout` ne rend donc pas l'appel
infini — il rend l'échec `provider_unavailable` au lieu de `timeout`, donc
transitoire dans les deux cas, mais mal nommé dans le journal. Les deux moyens
sont gardés ensemble pour la raison écrite dans
`packages/modules/auth/src/infrastructure/oauth-outbound.ts` : l'un annule
réellement quand le transport l'honore, l'autre garantit la borne quand il ne
l'honore pas.

## Ce que cet adapter ne fait pas

- **il ne présigne aucune lecture** (ADR 032). Servir l'image depuis le domaine
  du seau serait refusé par `img-src 'self'` (s45), et une URL de lecture est
  une capacité **détachée de l'appartenance** : elle ne peut pas tenir « un
  fichier d'organisation n'est lisible que par ses membres » à chaque requête ;
- **il ne vérifie pas le contenu.** `contentType` est lié à la signature, mais
  aucune signature ne lie un en-tête à des octets. Vérifier qu'un fichier est
  réellement une image appartient au module, après téléversement, par `read`.

## `write` n'est pas la voie d'un téléversement

Elle sert la **promotion** de l'ADR 033 : le module lui donne des octets qu'il
vient de lire et de vérifier, pour une clé qu'aucune URL présignée ne nomme. Les
octets d'un fichier reçu du navigateur, eux, ne traversent toujours pas
l'application — c'est le critère 2 de s18, et l'option B de l'ADR 032 l'a
rejeté pour la limite de corps de requête des plateformes. `write` passe par le
même `run` que les autres appels réseau : délai borné, reprises sur transitoires
seulement.

## `remove` rend un succès sur un objet absent

`docs/reliability.md` §1 : une purge rejouée ne doit produire aucun effet
supplémentaire, et l'état voulu — l'objet n'est plus là — est atteint dans les
deux cas. Distinguer les deux ferait échouer la seconde purge d'un périmètre
déjà purgé.

## Imports autorisés

- `@repo/ports` pour le port `Storage`, sa forme de résultat et celle du journal ;
- `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `@smithy/fetch-http-handler`
  — **le seul endroit du dépôt qui les importe** ;
- `@repo/typescript-config` pour la configuration du compilateur ;
- `vitest` dans les fichiers de test.

Ni `@repo/config` : le seau, la région, le point de terminaison et les
identifiants arrivent en arguments, ce qui rend cet adapter constructible dans
un test sans environnement.

## Ne doit jamais contenir

- de **second fournisseur**, ni de branche « si Supabase Storage alors… » ;
- de lecture de `NODE_ENV` ou de `process.env` : un stockage choisi par
  l'environnement est intestable et se trompera un jour d'environnement — c'est
  la même règle que pour le mailer, et elle a le même motif ;
- d'appel réseau **sans délai d'attente**, ni de reprise sur une erreur
  définitive ;
- de clé d'objet, de seau, d'octet de contenu, d'URL signée ni d'identifiant
  d'accès dans un journal ou dans un message d'erreur — **y compris quand c'est
  le fournisseur qui les a mis dans le sien**. Une clé d'objet porte
  l'identifiant du compte ou de l'organisation propriétaire : c'est une donnée
  personnelle ;
- de règle métier : cet adapter ne décide ni de ce qu'on téléverse, ni de qui a
  le droit de le lire.

## Tests

`src/s3-storage.test.ts` — **le réseau doublé (`globalThis.fetch`), le SDK
réel**. Ce que cela prouve tient à ce que cela double : la sérialisation réelle
de la requête, les en-têtes réels, le traitement réel de la réponse. Doubler
`client.send` par une fonction à soi n'éprouverait que cette fonction — c'est le
piège relevé en revue de s01.

Il n'y a **pas** de fichier d'envoi réel ici, contrairement à
`resend-live.test.ts` : ce dépôt n'a aucun seau de test, et un fichier de
recette qui n'a jamais tourné vaudrait moins que son absence. La recette contre
un vrai seau est un geste humain, décrit dans `.env.example`.

**Ce qui a été prouvé par mutation** (le compte est le nombre de cas passés au
rouge), sur les six neutralisations essayées :

| Neutralisation | Cas rouges |
|---|---|
| `isTransientStorageError` → `true` | 2 |
| `signableHeaders` retiré de la présignature | 1 |
| dispersion retirée du recul | 1 |
| plafond retiré du recul | 1 |
| assainissement des messages retiré | 2 |
| course du délai retirée | 1 |

Le cas du journal a dû être **corrigé** avant de mordre : tant que la réponse
du fournisseur ne portait pas de `<Message>`, retirer l'assainissement laissait
le cas vert — le SDK ne mettait alors ni la clé ni le seau dans son texte.
Le corps forgé porte désormais les deux, comme un vrai `<Error>` de S3. Une
preuve qui ne prouve pas coûte plus cher qu'une absence de preuve.
