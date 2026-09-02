# Recherche — s18-file-storage-avatar

> Ce qui a été **relevé dans le dépôt et dans les paquets installés**, jamais
> dans une documentation en ligne. Chaque affirmation dit où elle a été mesurée.
> Ce n'est pas la liste de ce qui existe : c'est la liste de ce qui a été
> balayé, et les cas balayés sont nommés.

Worktree `.claude/worktrees/agent-a415b28016db3ab55`, branche
`feature/s18-file-storage-avatar`, base PostgreSQL `s18`, parcours sur
`E2E_PORT=3118`.

## 1. Ce que la story demande, et ce que le dépôt en tient déjà

Les sept critères de `docs/stories.md`, confrontés à l'état livré :

| Critère | État avant cette story |
|---|---|
| 1 — interface `Storage` typée, seule surface appelée | **rien** : `packages/ports/src/` ne contient que `mailer.ts` |
| 2 — téléversement direct par URL présignée | rien |
| 3 — type MIME et taille contrôlés **côté serveur** | rien |
| 4 — avatar dans le menu de compte et les paramètres, remplacement supprimant le précédent | `apps/web/app/account-menu.tsx` rend une icône `UserIcon`, `packages/ui` n'a **pas** de composant `Avatar` |
| 5 — fichier d'organisation lisible par ses seuls membres | `resolveDataOwner` / `dataOwnerOf` existent (`apps/web/lib/organizations.ts`) |
| 6 — `purge` supprime les fichiers, `export` les liste | `purgeModules` / `exportModules` existent (`packages/core/src/registry.ts`) |
| 7 — module coupé : aucune route, aucune table, repli sur les initiales | le mécanisme existe (registre + `generated/`), il n'a jamais été exercé pour ce module |

## 2. Le gabarit de port, tel qu'il est écrit — et il est opposable

`packages/ports/src/mailer.ts` et `packages/ports/AGENTS.md` désignent
explicitement le storage comme **le suivant du même gabarit**. Quatre choix y
sont écrits avec leur motif, et ils sont repris tels quels :

1. **un fichier par capacité, un seul package `ports`** — un port n'a aucune
   dépendance d'exécution ; ce qu'il faut isoler est un SDK, donc un package par
   **adapter** ;
2. **l'opération rend un résultat discriminé, elle ne lève pas** ;
3. **les collaborateurs sont injectés** (horloge, hasard, sommeil, journal) ;
4. **la forme du journal est fermée** — `MailerLogRecord` n'a aucun champ où
   mettre une donnée personnelle.

`packages/adapters/resend/AGENTS.md` dit la même chose côté adapter et se
désigne comme « le gabarit de s3 ». Ce qui s'y répète et qui est repris ici :
délai d'attente explicite, reprises en recul exponentiel **dispersé et
plafonné**, sur erreurs transitoires **uniquement**, message du fournisseur
**assaini**.

`packages/mailer-testing/AGENTS.md` porte la troisième moitié : **la capture
locale est un opt-in, pas un repli**. Sans clé et sans drapeau, le montage
échoue en nommant les deux variables (revue de s06, F3 et G2). C'est le modèle
exact de `STORAGE_LOCAL_DIRECTORY` ci-dessous.

## 3. Le SDK, mesuré dans le paquet réellement installé

`@aws-sdk/client-s3@3.1123.0` et `@aws-sdk/s3-request-presigner@3.1123.0`
installés dans un bac à sable (`npm i` isolé, 27 paquets, 18 Mo,
**0 vulnérabilité**). Quatre constats décident du code de l'adapter, et ils
viennent d'une exécution, pas d'une lecture :

| Constat | Conséquence |
|---|---|
| `getSignedUrl(client, new PutObjectCommand({…}), { expiresIn, signableHeaders })` rend une URL portant `X-Amz-Expires`, `X-Amz-Date`, `X-Amz-Credential`, `X-Amz-Signature` — **jamais la clé secrète** | l'URL ne fuit aucun secret ; elle porte l'identifiant de clé, qui n'en est pas un |
| `signableHeaders: new Set(['content-type','content-length'])` produit `X-Amz-SignedHeaders=content-length;content-type;host` | l'URL **ne permet pas** d'écrire un autre type ni une autre taille : le fournisseur refuse la requête dont les en-têtes ne correspondent pas à la signature |
| la clé d'objet est **dans le chemin signé** | l'URL ne permet pas d'écrire ailleurs que là où elle prétend |
| `requestHandler: new FetchHttpHandler({ requestTimeout })` fait passer **tout** l'appel réseau par `globalThis.fetch` — mesuré : `GET …?x-id=GetObject` puis `DELETE …?x-id=DeleteObject` sont apparus dans le double | le régime de doublure du dépôt (« la doublure remplace le **réseau**, jamais le SDK ») s'applique à l'identique de `resend-mailer.test.ts` |

Par défaut (sans `requestHandler`), le SDK utilise `NodeHttpHandler`, qui parle
`node:http` : le double de `fetch` ne verrait alors **rien**. Le gestionnaire
est donc passé explicitement, et c'est ce qui rend l'adapter éprouvable.

`maxAttempts: 1` est posé sur le client : la politique de reprise du dépôt est
celle de l'adapter (recul dispersé plafonné, transitoires seulement), pas celle
du SDK. Deux politiques superposées multiplient les essais sans que personne
ne l'ait décidé.

## 4. Le piège que la story nomme : le type déclaré par le client ne prouve rien

Contrôler `contentType` à l'émission de l'URL présignée est **nécessaire et
insuffisant** :

- la signature lie le `Content-Type` de la requête de téléversement, donc un
  client ne peut pas envoyer `text/html` avec une URL signée pour `image/png` ;
- mais **rien ne lie l'en-tête au contenu**. Un `PUT` avec
  `Content-Type: image/png` et un corps `<svg onload=…>` ou `<html>` est accepté
  par le fournisseur.

Le contrôle réel est donc **la lecture des octets stockés, côté serveur, avant
d'enregistrer la ligne**. Signatures retenues, et ce sont les trois formats
acceptés — la liste est ce qui a été balayé, pas ce qui existe :

| Type | Signature relevée (octets de tête) |
|---|---|
| `image/png` | `89 50 4E 47 0D 0A 1A 0A` |
| `image/jpeg` | `FF D8 FF` |
| `image/webp` | `52 49 46 46` (`RIFF`) … `57 45 42 50` (`WEBP`) aux octets 8-11 |

Tout le reste — SVG (qui est du XML, donc du script potentiel), GIF, HTML, PDF,
une archive renommée — n'est pas un de ces trois et est refusé. Le SVG est
refusé **par construction** : il n'a pas de signature binaire, et l'accepter
reviendrait à servir du script depuis notre origine.

La **taille** est contrôlée deux fois pour la même raison : à l'émission (la
valeur annoncée, qui est liée par la signature) et à la confirmation (la taille
réellement lue). Une taille annoncée fausse ne survit pas à la seconde.

## 5. La politique de sécurité du contenu de s45 — mesurée, et elle mord

`apps/web/lib/security-headers.ts` émet, sans exception ni condition :

```
img-src 'self' <config/security.ts .img>
connect-src 'self' <config/security.ts .connect>
```

`config/security.ts` livre **les sept listes vides**. Deux conséquences pour
cette story, et elles ne sont pas symétriques :

1. **la lecture** — servir l'avatar depuis le domaine du seau serait refusé par
   `img-src 'self'`. C'est la raison n°1 pour laquelle l'avatar est **servi par
   l'application** (ADR 032). Ce n'est pas un contournement : c'est aussi ce qui
   rend le critère 5 vérifiable à chaque requête, là où une URL présignée de
   lecture serait une capacité détachée de l'appartenance ;
2. **l'écriture** — le `PUT` direct vers le seau est un appel réseau du
   navigateur, donc soumis à `connect-src 'self'`. **Avec un vrai seau S3/R2,
   son origine doit entrer dans `config/security.ts` `connect`.** Ce fichier
   appartient à une autre story : il n'est pas touché ici, il reste
   `connect: []`, et l'exigence est écrite dans `.env.example`, dans
   l'`AGENTS.md` du module et dans l'ADR 032. **Signalé, pas pris.**

L'état **livré** ne rencontre aucune des deux : le mode local présigne vers
**notre propre origine**, donc `connect-src 'self'` suffit, et un clone démarre
et téléverse sans toucher à la politique.

## 6. Où le code peut vivre, et où il ne peut pas

Relevé dans `eslint.config.ts` et `tooling/eslint/boundaries.ts` :

- `OUTBOUND_FETCH_SYNTAX` refuse **tout** `fetch(…)` dans
  `packages/modules/**`, sauf `infrastructure/oauth-outbound.ts`. Le module
  `storage` n'appelle donc jamais le réseau : c'est l'adapter qui le fait, et
  l'adapter n'est pas sous cette portée ;
- `domainForbiddenSources` contient déjà `@aws-sdk/*`, `@repo/ports` et
  `@repo/adapter-*` : le `domain` du module ne peut connaître ni le SDK, ni le
  port ;
- le composant qui téléverse appelle `fetch` : il vit donc dans `apps/web`,
  comme `app/public-form.tsx` (s11) et `app/auth-form.tsx` (s07), et pour la
  raison écrite dans `apps/web/AGENTS.md` — élargir une garde de fiabilité pour
  un appel navigateur → notre propre route est exactement ce que le dépôt
  refuse ;
- `packages/ui` est la **seule** frontière avec Radix (ADR 022) : le composant
  `Avatar`, annoncé par `docs/design-system.md` et absent de
  `packages/ui/src/index.ts`, se copie là et nulle part ailleurs.

## 7. Le contrat de module, et ce qu'il oblige à déclarer

`packages/core/src/module.ts` — quatorze clés, toutes obligatoires. Deux
garanties du **compilateur** touchent cette story : `retention` est indexée par
`dataCategories`, et `emails[].locales` par les locales de `messages`.

`purgeModules` parcourt les modules **à l'envers du graphe** (ADR 029) : un
dépendant avant son requis. `storage` déclarant `requires: ['auth']`, sa purge
s'exécute **avant** celle de `auth` — c'est l'ordre dans lequel elle peut encore
résoudre ce qu'elle doit effacer. C'est la leçon de s16 (une adresse survivait
à la purge) et c'est exactement le piège que la story nomme.

`packages/db/src/references.ts` refuse toute clé étrangère vers un module non
déclaré en `requires`. Conséquence directe sur le schéma : `storage_file` ne
peut **pas** référencer `organization` sans faire de `organizations` un requis,
ce qui rendrait le storage indisponible en mode mono-utilisateur. Le
propriétaire est donc porté par deux colonnes (`owner_kind`, `owner_id`), qui
sont exactement la forme de `ModuleScope`.

## 8. Ce qui casserait si on ne le sait pas

Relevé dans les suites existantes, chacune vérifiée en la lisant :

- `tests/marketing.test.ts` compte les connexions `pg` ouvertes pendant le rendu
  de l'accueil public, d'une page légale et de l'**`AppShell`**. Une lecture de
  base ajoutée au shell pour un visiteur **anonyme** ferait rougir cette mesure.
  L'avatar n'est donc lu que lorsqu'il y a un compte ;
- `tests/rendered-text.test.ts` rend chaque écran avec un catalogue
  pseudo-locale et refuse toute chaîne qui n'est pas un marqueur. Une URL
  d'avatar est une **donnée** : elle passe par `technicalProps` de l'écran qui
  la porte, ou par une valeur de fixture énumérée — jamais par une concession
  globale ;
- `tests/organizations.test.ts` dérive **du disque** les segments de premier
  niveau de `apps/web/app` et exige que chacun soit un identifiant réservé.
  Cette story n'ajoute aucun écran de premier niveau, donc rien à réserver ;
- `tests/env-example.test.ts` compare `.env.example` aux clés du schéma : toute
  variable neuve doit y figurer ;
- `tests/agents-md.test.ts` exige un `AGENTS.md` par package : les trois
  packages neufs en ont un ;
- `e2e/modules.spec.ts:55` est **déjà** rouge quand tous les modules sont
  activés (dette s03, nommée dans `docs/architecture.md`). Cette story ajoute un
  module de plus à l'annuaire ; elle ne change pas cette dette, et
  `demo-disabled` reste le module coupé qui la tient.

## 9. Les points que la recherche laisse ouverts, et ce qui les tranche

1. **URL présignée de lecture ou lecture servie par l'application ?** Tranché
   par ADR 032 : servie par l'application. Motifs mesurés — `img-src 'self'`
   (§5) et le critère 5, qu'une capacité détachée ne tient pas.
2. **Comment l'étape de confirmation autorise-t-elle une clé ?** Sans jeton
   signé : la clé est confirmée **seulement si son préfixe est celui du
   périmètre de l'appelant** (`avatars/<kind>/<id>/`). Un préfixe étranger rend
   404. C'est la même règle que celle qui a émis l'URL, appliquée au même
   endroit, sans second secret à gérer.
3. **Une organisation a-t-elle un avatar dans cette story ?** Le port, la table
   et la purge portent les deux périmètres ; l'**écran** livré est celui du
   compte. Le périmètre organisation est exercé par les cas de lecture et de
   purge, pas par un second écran — c'est ce que le critère 5 demande, et rien
   de plus.
