# packages/mailer-testing — règles locales

**Outils de test et de développement du port `Mailer`. Ce ne sont pas des
fournisseurs.**

C'est la phrase la plus importante de ce fichier, et elle est opposable : ADR 008
livre **une seule implémentation par port**, et cette implémentation est Resend
(`packages/adapters/resend`). SMTP, SendGrid et Nodemailer sont au cimetière du
PRD. Rien de ce que contient ce package ne les rend légitimes — parce que rien
ici ne parle à un service tiers.

Deux outils, deux usages :

| Outil | Ce qu'il fait | Quand |
|---|---|---|
| `createRecordingMailer` | garde les envois en mémoire, n'envoie rien, **ne rend rien** | en CI : le test affirme destinataire, template et données |
| `createLocalCaptureMailer` | rend l'email et l'écrit dans un dossier, ignoré par git | en développement, sans clé d'API (`docs/reliability.md` §2) |

La doublure ne rend pas le template, délibérément : rendre en CI ferait dépendre
chaque test d'envoi de la mise en page des emails, et un template cassé ferait
rougir des suites qui ne parlent pas d'emails. Le rendu est prouvé là où il vit,
dans `@repo/emails`.

**Ces outils sont injectés, jamais sélectionnés par `NODE_ENV`.** C'est le piège
nommé par la story et par la recherche de s01 : un mailer choisi par
l'environnement est intestable et se trompera un jour d'environnement. Le choix
se fait au point de composition (`apps/web/lib/mailer.ts`), sur la **présence
d'une clé d'API**, et `tests/mailer.test.ts` échoue si `NODE_ENV` reprend la
main.

## Imports autorisés

- `@repo/ports` pour le port `Mailer` et sa forme de résultat ;
- `node:fs/promises` et `node:path` pour la capture locale — c'est le seul
  endroit du couple port/adapters qui touche au disque ;
- `@repo/typescript-config` pour la configuration du compilateur ;
- `vitest` dans les fichiers de test.

Aucun SDK, aucun client HTTP : un outil qui appellerait un service tiers ne
serait plus un outil de test.

## Ne doit jamais contenir

- **d'implémentation qui envoie réellement un email** : ce serait un second
  adapter, et ADR 008 n'en livre qu'un ;
- de lecture de `NODE_ENV` ni de `process.env` : le point d'accès unique à
  l'environnement est `@repo/config`, et la sélection d'un mailer se fait par
  injection ;
- de chemin d'écriture deviné (`process.cwd()`, racine du dépôt) : le dossier de
  capture est **injecté**, comme le rendu ;
- de règle métier : ces outils ne décident pas quand un email part.

## Tests

`src/mailer-testing.test.ts`, à côté du code qu'il couvre (`pnpm test`). Un seul
fichier pour les deux outils : le coût d'une suite est dominé par le fichier,
pas par l'assertion.

Ce qui est prouvé ici et qui mord — vérifié par mutation : le nom de fichier
reste dans le dossier **et** n'écrase pas la capture précédente quand le
template porte un chemin ; une écriture refusée dégrade en résultat d'échec
plutôt que de lever ; la liste des envois est un instantané, pas la liste
vivante.
