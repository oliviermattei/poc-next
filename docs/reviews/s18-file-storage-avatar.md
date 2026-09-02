# Revue — s18-file-storage-avatar

Worktree `.claude/worktrees/agent-a415b28016db3ab55`, branche
`feature/s18-file-storage-avatar`, commit unique `e1c0e70`, base PostgreSQL
`s18`. Diff jugé : `git diff dev...feature/s18-file-storage-avatar`
(66 fichiers, 6 848 insertions, quatre paquets neufs).

> Ce rapport dit **ce qui a été balayé**, pas ce qui existe. Les cas sont
> nommés, les mutations sont comptées, et chacune a été restaurée dans la
> commande qui la posait (`git diff --exit-code` vert avant l'écriture de ces
> lignes).

## 1. Ce qui a été exécuté

Dans les **deux configurations de modules** (`storage` activé, puis coupé par
`pnpm ks toggle storage`, puis rétabli — arbre vérifié propre après) :

| Commande | Module activé | Module coupé |
|---|---|---|
| `pnpm typecheck` | vert (19 tâches) | vert |
| `pnpm lint --max-warnings=0` | vert | vert |
| `pnpm test` | 1 217 passés, 2 ignorés, 37 fichiers | 1 217 passés |
| `E2E_PORT=3118 pnpm test:e2e` | 62 passés, 6 ignorés | 60 passés, 8 ignorés |
| `pnpm build` | vert (`--force`) | vert |
| `pnpm run audit` | 1 avis, aucun non couvert au seuil « élevé » | idem |
| `pnpm db:migrate` × 2 | applique, puis « rien à appliquer » | — |

Et une vérification navigateur **sous le build de production** (`next start`,
port 3120, `NODE_ENV=production`), qui est là où le constat bloquant a été
mesuré.

## 2. Constats

### F1 — critique — le périmètre d'écriture et le périmètre d'affichage divergent

`apps/web/lib/storage.ts` donne au module deux fonctions qui ne parlent pas du
même propriétaire :

- **écriture** : `ownerOf` = `dataOwnerOf({ userId, roles: [] })`, qui rend
  **l'organisation active** dès qu'il y en a une (`resolveDataOwner`,
  `packages/core/src/protection.ts`) ;
- **affichage** : `storage.avatarOf` appelle `useCases.avatarOf({ kind: 'user', id: userId })`,
  **toujours** le compte.

Créer une organisation la rend courante (`setActiveOrganization`,
`packages/modules/organizations/src/application/organization-use-cases.ts:451`).
L'état par défaut du dépôt active `organizations`. Le parcours mesuré, sous le
build de production :

| Geste | Résultat observé |
|---|---|
| téléverser avant toute organisation | clé `avatars/user/<uid>/…`, avatar affiché ✔ |
| créer une organisation | avatar personnel toujours affiché |
| **téléverser depuis `/account`** | `confirm` **200**, clé `avatars/organization/<org>/…` — et **l'écran ne change pas** : l'ancienne image reste |
| **cliquer « Retirer »** | **204**, et l'avatar reste affiché : ce qui a été supprimé est le fichier de **l'organisation** |

Trois conséquences, et aucune n'est cosmétique :

1. **le critère 4 est cassé** — « l'avatar téléversé s'affiche dans le menu de
   compte et dans les paramètres ; le remplacement supprime le fichier
   précédent ». Ni l'un ni l'autre dès qu'une organisation est active ;
2. **une action destructrice inter-périmètre est annoncée comme un succès** :
   « Retirer ma photo » supprime la ligne **et l'objet** d'une ressource
   partagée, l'avatar de l'organisation, et rend 204 ;
3. **elle n'est gardée par aucun rôle.** s17 énumère six actions
   d'organisation, toutes refusées à un `member`
   (`packages/modules/organizations/src/domain/permissions.ts`). Écrire et
   supprimer le fichier de l'organisation n'est dans aucune de ces six, et les
   cinq routes de `storage` sont `authenticated`. Un `member` écrit donc dans
   le périmètre de l'organisation, et l'efface, sans garde —
   `docs/security.md` §3, « permissions vérifiées côté serveur ».

Pourquoi personne ne l'a vu : `tests/storage.test.ts` **injecte** `ownerOf` et
`readableScopes` (ligne ~137, `writeOwner` / `readScopes`), donc il n'exerce
jamais le câblage réel ; et `e2e/storage.spec.ts` ne crée jamais
d'organisation. Le seul chemin qui met les deux fonctions en présence est
l'application, et rien ne le traverse.

Mesuré par sonde Playwright temporaire, deux fois, sous `next start` (sonde
supprimée, arbre vérifié propre).

### F2 — majeur — l'URL présignée reste valable après la confirmation

Le contrôle central de la story est la relecture des octets à la confirmation
(ADR 032, conséquence 1). Il n'est pas durable : l'URL présignée vit
`UPLOAD_URL_TTL_SECONDS = 120`, et rien ne la révoque au moment du `confirm`.

Mesuré, sous le build de production :

```
PUT initial = 200 · confirm = 200
REJEU de l'URL présignée après confirmation = 200
GET /file = 200 · content-type = image/png
octets servis = "<svg xmlns=... onload=\"alert(1)\"/> "
```

Des octets arbitraires, de même longueur et sous le même `Content-Type`
signé, remplacent l'objet **vérifié**, et la route de lecture les sert. La
signature lie le type et la taille (constat 3 de la recherche, confirmé par
mutation), donc la longueur reste vraie et le type servi reste `image/png` —
mais « ce qui a été validé » et « ce qui est servi » ne sont plus la même
chose.

Ce que le dépôt tient quand même, et qui borne la gravité : `nosniff`,
`content-type` pris **en base** et non chez le fournisseur, `content-disposition:
inline`, CSP `default-src 'self'`. Le navigateur n'exécute rien. Le défaut est
une perte d'intégrité du contenu servi, pas une exécution.

Il vaut à l'identique avec un vrai seau : une URL présignée S3 reste valable
jusqu'à son échéance. Les réponses possibles — TTL très court refermé par la
confirmation, jeton d'usage unique, ou relecture au service — appartiennent au
cycle suivant.

### F3 — majeur — l'exigence `config/security.ts` `connect` n'est portée par aucune commande

L'ADR 032, `.env.example` et `packages/modules/storage/AGENTS.md` disent tous
trois que l'origine d'un seau réel doit entrer dans `config/security.ts` champ
`connect`, faute de quoi `connect-src 'self'` refuse le `PUT` direct. C'est
écrit **avant** le déploiement, à côté des variables — le point 9 de la
mission est tenu sur ce plan.

Mais aucune commande ne rougit. Un agent qui renseigne les quatre
`STORAGE_S3_*` obtient un `pnpm dev` qui démarre, un `pnpm build` qui compile,
une CI verte — et un téléversement refusé **par le navigateur**, donc invisible
dans les journaux du serveur. `AGENTS.md` racine : « une règle sans commande
est de la documentation, pas une règle ». `resolveStorageConfig` connaît
pourtant l'origine du seau et lit déjà l'environnement au démarrage : la garde
était à portée.

### F4 — majeur — `cache-control: private, no-store` n'est net par aucun test

Mutation : `packages/modules/storage/src/presentation/storage-routes.ts`,
`'private, no-store'` → `'public, max-age=31536000'`.
**Résultat : 0 rouge sur 1 217.** Aucun `cache-control` n'est asserté nulle
part (`grep` sur `tests/` et `e2e/` : aucune occurrence).

Un avatar est une donnée personnelle servie derrière une session : un cache
partagé qui le garde le sert au visiteur suivant. Le code est bon ; son filet
n'existe pas. `AGENTS.md` racine : « une mutation verte veut dire que le test
est faux, pas que le code est bon ».

### F5 — mineur — un compte de mutations faux dans `AGENTS.md`

`packages/modules/storage/AGENTS.md` : « sur les **six** neutralisations
essayées », suivi d'un tableau de **huit** lignes. C'est exactement la
discipline de comptage que ce dépôt s'impose (ADR 013). Les valeurs, elles,
ont été revérifiées et tiennent — j'ai remesuré cinq des huit, avec les mêmes
comptes.

### F6 — mineur — code mort dans un test de l'adapter

`packages/adapters/s3/src/s3-storage.test.ts`, cas « rend les octets et le type
stockés » : une première affectation de `globalThis.fetch` est immédiatement
écrasée par la seconde. Sans effet, mais un lecteur y cherche une intention.

## 3. Les mutations posées, et ce qu'elles ont fait rougir

Toutes restaurées par `git checkout --`, arbre vérifié après chacune.

| Neutralisation | Fichier | Cas rouges |
|---|---|---|
| `validateStoredAvatar` rend le type déclaré | `domain/avatar.ts` | **4** |
| `keyBelongsTo` rend toujours `true` | `domain/avatar.ts` | **3** |
| contrôle de périmètre retiré de `readFile` | `application/storage-use-cases.ts` | **2** |
| purge qui supprime la ligne sans l'objet | idem | **1** |
| objet précédent non supprimé au remplacement | idem | **1** |
| repli silencieux sur le disque sans configuration | `apps/web/lib/storage-config.ts` | **2** |
| vérification d'échéance retirée du téléversement local | `storage-testing/local-disk-storage.ts` | **1** |
| signature HMAC non vérifiée | idem | **1** |
| tout classé transitoire | `adapters/s3/retry.ts` | **2** |
| dispersion retirée du recul | idem | **1** |
| `signableHeaders` retiré de la présignature | `adapters/s3/s3-storage.ts` | **1** |
| `cache-control` → `public, max-age=31536000` | `presentation/storage-routes.ts` | **0** → F4 |
| jeton de fraîcheur `updatedAt` → `createdAt` | `application/storage-use-cases.ts` | **0** en Vitest, **1 parcours Playwright** |

La dernière est le cas honnête : verte en nœud, rouge au navigateur. C'est
l'endroit où elle doit mordre, et elle y mord — l'implémenteur l'avait dit, et
c'est vrai.

## 4. Le fichier hostile, instruit plutôt que cru

Sous le build de production, compte connecté, chaque cas soumis par la vraie
route. Voici **ce qui a été essayé**, huit cas, et non ce qui existe :

| Cas | Réponse |
|---|---|
| PNG réel | `confirm` 200, image chargée (`naturalWidth = 1`) |
| SVG avec `<script>` et `onload`, annoncé `image/png` | `confirm` **422 `content_mismatch`**, objet retiré du seau |
| `image/svg+xml` annoncé | `presign` **422 `unsupported_type`** |
| taille annoncée fausse (10 annoncés, 70 envoyés) | `PUT` **403** — la taille est liée à la signature |
| fichier vide (`size: 0`) | `presign` **422 `invalid_size`** |
| fichier énorme (50 Mo annoncés) | `presign` **422 `too_large`** |
| clés `../../../etc/passwd`, `avatars/user/../../evade.png`, `avatars/user/x/../../../../evade.png` | `confirm` **404** dans les trois cas |
| **servir** ce qui a pu être stocké | `content-type: image/png` (pris **en base**), `x-content-type-options: nosniff`, `content-disposition: inline`, `cache-control: private, no-store`, CSP `default-src 'self'` |

Aucun chemin trouvé, sur ces huit, qui fasse exécuter du contenu utilisateur
chez le visiteur. Le seul écart mesuré est F2, et il ne franchit pas
`nosniff`.

**L'URL présignée**, quatre essais : détournée vers la clé d'un autre compte →
**403** ; échéance modifiée dans la requête → **403** ; type ou taille
modifiés → **403** ; rejouée après confirmation, à l'identique → **200**
(F2). Elle ne porte aucun secret — vérifié par le test de l'adapter et par
lecture de l'URL locale (clé, type, longueur, échéance, signature).

**404 et jamais 403** : fichier d'autrui et identifiant inventé rendent le
même statut **et** le même corps (`{"error":"not_found"}`), médianes sur
12 mesures **7 ms contre 7 ms**. Indication, pas preuve statistique.

**La purge et le remplacement** : exécutés contre la vraie base et le vrai
disque (`tests/storage.test.ts`, 23 cas verts, base `s18` joignable). La purge
supprime **l'objet** — la mutation inverse rougit —, elle est rejouable sans
effet de plus, et elle s'exécute **avant** celle de `auth` (ADR 029),
observé par une doublure de contrat et non affirmé. Le remplacement supprime
l'objet précédent, et confirmer deux fois la même clé ne supprime pas ce qui
vient d'être enregistré.

**Le mode local** : opt-in explicite, jamais déduit de `NODE_ENV` (deux axes
croisés dans le test) ; les deux configurations à la fois sont refusées par le
schéma d'environnement ; un seau à moitié renseigné nomme l'absente ; sans
rien, le démarrage échoue en nommant les deux voies. Une différence assumée
avec s12 mérite d'être vue : `OAUTH_LOCAL_PROVIDER` **refuse de s'armer sous
`NODE_ENV=production`** (`apps/web/lib/oauth-config.ts:116`, vérifié en le
déclenchant) ; `STORAGE_LOCAL_DIRECTORY` n'a pas d'équivalent. Ce n'est pas un
repli silencieux — le choix reste explicite —, mais un `.env` recopié d'un
poste écrirait les avatars sur un disque éphémère de production, et le
symptôme serait un avatar qui disparaît au redémarrage. À arbitrer, pas à
corriger en revue.

## 5. Diff contre plan, et le découpage

Les onze tâches du plan sont faites, et rien n'y a été ajouté qu'elles
n'aient demandé, à une exception près : `packages/ui/src/lib/initials.ts`
(`initialsOf`), que la tâche 7 ne nommait pas et que le repli sur les
initiales rendait nécessaire. Justifié, et documenté à sa place.

Les **cinq fichiers de test** ne violent aucune règle : ils occupent les trois
emplacements autorisés — `src/**/*.test.ts` dans trois paquets, `tests/` à la
racine, `e2e/`. Ce n'est pas cinq fichiers pour un emplacement, c'est un
fichier par paquet neuf.

En revanche, **la story aurait dû être découpée**, et F1 en est la
démonstration. Elle porte un port, son adapter, un outil de développement, un
module à quatre couches, un composant de design system, deux écrans et une
ADR structurante — 66 fichiers pour une complexité annoncée de 3. Coupée en
deux (le port + l'adapter + le stockage local d'un côté ; le module avatar et
ses écrans de l'autre), la seconde moitié aurait eu un parcours dédié à
l'appartenance, et la divergence entre `ownerOf` et `avatarOf` serait tombée
dans son propre e2e au lieu de survivre à 1 217 cas verts.

## 6. Ce que la fusion avec `dev` exposera

`dev` a avancé de quatre commits depuis la base (`8c32cdf`) : **s14, les
passkeys**. s17 était déjà dans la base, contrairement à ce que la consigne
supposait — les rôles d'organisation sont donc bien présents dans la branche,
et c'est ce qui rend le troisième point de F1 opposable dès maintenant.

Trois fichiers sont touchés des deux côtés et **entreront en conflit
textuel** : `apps/web/app/account/page.tsx` (les deux ajoutent une carte),
`tests/fixtures/screen-viewer.ts` et `tests/rendered-text.test.ts` (les deux
ajoutent des fixtures et des `TECHNICAL_PROPS`). Conflits de voisinage, pas de
sémantique — mais à résoudre à la main, et à revérifier par `pnpm test` après.

Un détail à surveiller à la fusion : `apps/web/lib/storage.ts` appelle
`dataOwnerOf({ userId, roles: [] })` avec une **session forgée** dont la liste
de rôles est vide. `resolveDataOwner` ne lit que `userId` aujourd'hui, donc
c'est inerte ; le jour où elle consultera `roles`, ce `[]` dégradera en
silence. Aucun test ne le verrait.

## 7. Ce que je n'ai pas pu vérifier

Le dire est la moitié du travail :

- **aucun seau réel n'a été contacté.** L'adapter est éprouvé avec le SDK réel
  et le réseau doublé — c'est le régime du dépôt —, mais le comportement d'un
  vrai S3/R2 face à une signature dont les en-têtes ne correspondent pas, face
  à une URL expirée, et ses codes HTTP réels, restent **inférés** de la mesure
  en bac à sable de la recherche. Le geste humain : le régime « clés de test
  réelles », sur commande explicite, avant le ship ;
- **`config/security.ts` avec un seau réel n'a jamais été rendu.** Personne
  n'a vu le navigateur faire un `PUT` vers une origine tierce sous cette CSP,
  ni l'échec qu'elle produit. C'est exactement le terrain de F3 ;
- **l'avatar d'organisation n'a aucun écran.** Le périmètre organisation n'est
  exercé que par des fixtures injectées et par mes sondes ; aucun parcours
  livré ne le traverse ;
- **la concurrence n'a pas été exercée.** Le verrou consultatif
  `pg_advisory_xact_lock` de `replaceAvatar` n'a jamais vu deux confirmations
  simultanées ; je n'ai pas lancé de test concurrent ;
- **la purge par le vrai chemin de suppression de compte n'existe pas** (s34).
  J'ai appelé `purgeModules` directement ;
- **l'indistinguabilité temporelle** repose sur 12 mesures en local
  (7 ms / 7 ms). C'est une indication, pas une preuve ;
- **le rendu mobile et le thème sombre** de la carte « Photo de profil » n'ont
  pas été regardés ; la conformité au mockup `docs/designs/s18-*.html` n'a pas
  été comparée pixel à pixel ;
- **la limitation de débit n'existe pas encore** (s28). Un compte authentifié
  peut appeler `presign` en boucle et déposer des objets de 2 Mo qu'aucune
  ligne ne nommera — la dette d'orphelins est nommée dans l'ADR 032 et
  renvoyée à une règle de cycle de vie du seau, qui est un geste
  d'exploitation. À vérifier par un humain le jour où un vrai seau est branché.

## 8. Verdict

Le socle technique est solide et honnête : le port ne lève pas, l'adapter est
éprouvé le SDK réel et le réseau doublé, le mode local est un opt-in qui ne se
déduit de rien, la purge supprime l'objet, les onze mutations sur les
invariants nommés rougissent toutes. Deux commentaires du code annoncent
eux-mêmes une garde inatteignable plutôt que de la faire croire — c'est la
bonne discipline.

Mais le câblage de l'application attribue les fichiers à un propriétaire que
l'écran ne lit jamais. Le geste central de la story — « je change ma photo » —
ne fonctionne pas dès qu'une organisation est active, et le bouton « Retirer »
efface la ressource d'un autre périmètre en rendant un succès. Ce n'est pas
un détail d'affichage : c'est le critère 4, et c'est une écriture non gardée
dans le périmètre d'une organisation.

Verdict du **premier tour**, conservé tel quel — le verdict courant est celui de
la section 9, en fin de fichier :

Max severity: critical
Ship allowed: no

## 9. Clôture — ce qui a été corrigé, et ce qui le tient

Tour de correction sur `feature/s18-file-storage-avatar`, commit **`6d5d647`**,
posé après le commit de story `e1c0e70`. Base PostgreSQL `s18`, parcours
`E2E_PORT=3118`. Constat par constat.

### F1 — critique — deux propriétaires pour un seul avatar → **corrigé**

Tranché : **l'avatar de `/account` est celui de la personne.**
`apps/web/lib/storage.ts` ne consulte plus `dataOwnerOf` ; il donne au module
une résolution de propriétaire unique, et le module la rejoue pour les **trois**
chemins — `presign`, `confirm`, `remove` par les routes, l'affichage par
`avatarOfUser` (`infrastructure/storage-runtime.ts`). L'application ne fabrique
plus aucun `FileOwner` : la divergence n'a plus d'endroit où naître.

Le périmètre organisation reste dans le `domain` et **est inatteignable par
l'application livrée** — aucun écran ne l'écrit. C'est écrit dans
`packages/modules/storage/AGENTS.md` et dans `apps/web/AGENTS.md`, avec la
raison. `readableScopes` continue de l'énumérer en lecture, et n'y trouve
aujourd'hui aucun fichier.

Deux filets, aux deux endroits où le défaut vivait :

| Neutralisation | Cas rouges |
|---|---|
| `avatarOfUser` fabrique son propre `{ kind: 'user' }` | **1** (`tests/storage.test.ts`) |
| `ownerOf` rendu à `dataOwnerOf` (l'organisation active) | **1 parcours** (`e2e/storage.spec.ts`) |

Le second est le parcours neuf : il crée une organisation — qui devient
courante —, téléverse, puis crée une **seconde** organisation et exige que la
photo du compte lui survive. Sous l'ancien câblage, il rougit exactement là.

### F2 — majeur — l'URL présignée survit à la confirmation → **corrigé**

La voie proposée a été retenue, et elle est la seule qui ne dépende pas du
fournisseur : **clé d'attente, puis promotion** (ADR 033, avec les trois voies
écartées — TTL plus court, jeton d'usage unique, relecture au service — et une
quatrième, la copie côté fournisseur, qui rouvrait la fenêtre qu'on ferme).

- `presign` émet vers `pending/<kind>/<id>/<hasard>.<ext>` ;
- `confirm` lit, vérifie, puis **écrit lui-même les octets vérifiés** vers
  `avatars/<kind>/<id>/…` et retire l'objet d'attente ;
- le port `Storage` gagne `write` — son en-tête prévoyait ce jour —, portée par
  l'adapter S3 et par le stockage sur disque.

Mesuré sous le build de production, compte connecté :

```
clé présignée = pending/user/<uid>/04977e0eff2d…png
PUT initial = 200 · confirm = 200 · REJEU de l'URL présignée = 200
GET /file = 200 · image/png · private, no-store
octets servis = 137,80,78,71,13,10,26,10 …  (le PNG vérifié, inchangé)
```

Le rejeu répond toujours 200 — c'est le fournisseur qui décide, et c'est
attendu —, mais il n'atteint plus rien de servi.

| Neutralisation | Cas rouges |
|---|---|
| promotion retirée : la clé présignée redevient la clé servie | **5** |

### F3 — majeur — une exigence qu'aucune commande ne vérifiait → **corrigé**

`apps/web/lib/storage-config.ts` **lit** `config/security.ts` — il ne le
modifie pas, ce fichier appartient à s45 — et refuse le démarrage quand un seau
réel est configuré sans que son origine figure dans `connect`. Le message nomme
l'origine attendue (celle du point de terminaison, ou
`https://s3.<region>.amazonaws.com`), le fichier et le champ.

Mesuré dans la vraie commande, quatre variables renseignées, `next start` :

```
Error: Le seau « avatars » est configuré, mais son origine
https://s3.eu-west-3.amazonaws.com n’est pas déclarée dans `config/security.ts`,
champ `connect`. …
curl / → aucune réponse (le processus ne sert rien)
```

| Neutralisation | Cas rouges |
|---|---|
| garde d'origine retirée | **1** |

### F4 — majeur — un en-tête juste que rien ne tenait → **corrigé**

`tests/storage.test.ts` asserte `cache-control: private, no-store` sur la route
de lecture.

| Neutralisation | Cas rouges |
|---|---|
| `cache-control` → `public, max-age=31536000` | **1** (0 avant) |

### Le mode local refuse la production → **aligné sur `OAUTH_LOCAL_PROVIDER`**

`STORAGE_LOCAL_DIRECTORY` posé avec `NODE_ENV=production` arrête le démarrage en
nommant la variable. `NODE_ENV` n'arme toujours rien — il **restreint**. Mesuré
dans la vraie commande (`next start`, `.env` du poste) : le processus meurt et ne
répond pas.

| Neutralisation | Cas rouges |
|---|---|
| refus du disque en production retiré | **1** |

### Mineurs → **corrigés**

`packages/modules/storage/AGENTS.md` : les comptes sont désormais dérivés des
tableaux (trois neutralisations dans le `domain`, douze dans le câblage, deux au
navigateur), et chaque tableau porte ce qui a été **essayé**, pas ce qui existe.
`packages/adapters/s3/src/s3-storage.test.ts` : l'affectation morte a disparu.

### Ce qui a été exécuté, dans les deux configurations de modules

`storage` activé, puis coupé par `pnpm ks toggle storage`, puis rétabli — arbre
vérifié propre après, `config/features.ts` et `generated/` inchangés.

| Commande | Module activé | Module coupé |
|---|---|---|
| `pnpm typecheck` | vert (19 tâches) | vert |
| `pnpm lint --max-warnings=0` | vert | vert |
| `pnpm test` | **1 228** passés, 2 ignorés, 37 fichiers | 1 228 passés |
| `E2E_PORT=3118 pnpm test:e2e` | **63** passés, 6 ignorés | 60 passés, 9 ignorés |
| `pnpm build --force` | vert | vert |
| `pnpm run audit` | 1 avis, aucun non couvert au seuil « élevé » | idem |

Et une vérification navigateur **sous le build de production** (`next start` sur
l'arbre construit par `pnpm build --force`), avec une organisation courante :
avatar téléversé, image réellement chargée (`naturalWidth = 1`), conservée après
bascule vers une seconde organisation (même identifiant de fichier), retirée par
« Retirer ». Une réserve, dite plutôt que sous-entendue : ce serveur a été lancé
avec `NODE_ENV=development`, parce que le stockage sur disque refuse désormais
`NODE_ENV=production` — c'est la garde ajoutée ici, mesurée à part. Le code servi
est bien celui du build de production ; le mode de la politique de sécurité du
contenu, lui, est celui du développement.

### Ce qui reste ouvert, et n'a pas changé

Les limites de la section 7 tiennent toujours : aucun seau réel contacté, aucun
rendu de `config/security.ts` avec une origine tierce déclarée, aucun écran
d'avatar d'organisation, aucune exercice de concurrence, pas de limitation de
débit (s28), pas de suppression de compte réelle (s34). S'y ajoute une dette
nommée par l'ADR 033 : le préfixe `pending/` accumule les objets non confirmés et
les rejeux, et sa réponse reste une **règle de cycle de vie sur le seau**, geste
d'exploitation — écrite dans `.env.example`.

Le découpage reste ce que la section 5 en dit ; ce tour n'y change rien.

Max severity: none
Ship allowed: yes

## 10. Seconde revue — indépendante, après le tour de correction

Les deux lignes de la section 9 sont la **mesure de l'implémenteur**, annoncée
comme telle et soumise à revalidation. Ce qui engage le dépôt est le verdict qui
termine ce fichier.

Worktree `.claude/worktrees/agent-a415b28016db3ab55`, HEAD `6d5d647`, base
PostgreSQL `s18`, parcours `E2E_PORT=3118`. Diff prioritaire
`git diff e1c0e70..6d5d647` (23 fichiers), story entière
`git diff dev...feature/s18-file-storage-avatar`.

> Ce rapport dit **ce qui a été balayé**, jamais ce qui existe. Chaque
> neutralisation a été restaurée dans la commande qui la posait, et l'arbre
> vérifié (`git diff --exit-code`) avant la ligne suivante.

### 10.1 Ce qui a été exécuté, dans les deux configurations de modules

`storage` activé, puis coupé par `pnpm ks toggle storage`, puis rétabli — les
empreintes de `config/features.ts`, `generated/schema/index.ts` et
`generated/schema/storage.ts` sont **identiques** avant et après, arbre propre.

| Commande | Module activé | Module coupé |
|---|---|---|
| `tsc --noEmit` + `turbo run typecheck --force` | vert (19 tâches, 0 en cache) | vert |
| `pnpm lint --max-warnings=0` | vert | vert |
| `pnpm test` | **1 228** passés, 2 ignorés, 37 fichiers | 1 228 passés |
| `E2E_PORT=3118 pnpm test:e2e` | **63** passés, 6 ignorés | 60 passés, 9 ignorés |
| `pnpm build --force` | vert (0 en cache) | vert (0 en cache) |
| `pnpm run audit` | 1 avis, aucun non couvert au seuil « élevé » | idem |
| `pnpm db:migrate` × 2 | applique, puis « rien à appliquer » | — |

Le premier `pnpm typecheck` a rendu **FULL TURBO** : le piège annoncé est réel.
Les chiffres ci-dessus sont ceux des exécutions forcées.

### 10.2 Les quatre constats, remesurés un par un

**F1 — les trois chemins résolvent-ils le même propriétaire ?** Oui, et par
construction : `apps/web/lib/storage.ts` ne fabrique plus aucun `FileOwner`, il
donne `ownerOf` au module ; `presign`, `confirm` et `remove` la rejouent depuis
les routes, l'affichage depuis `avatarOfUser`, qui appelle `options.ownerOf`.
Les deux surfaces d'affichage — le menu de compte du shell et la carte
`/account` — passent toutes deux par `storage.avatarOf`, donc par cette porte.

| Neutralisation | Cas rouges |
|---|---|
| `avatarOfUser` fabrique son propre `{ kind: 'user', id: userId }` | **1** (`tests/storage.test.ts`) |
| `ownerOf` de l'application rendu à `dataOwnerOf` (organisation active) | **1 parcours** (`e2e/storage.spec.ts:151`, échoue sur `avatarImage` invisible après bascule) |
| `servedKeyOf` sans sa garde de périmètre | **3** (1 dans `tests/storage.test.ts`, 2 dans `storage-rules.test.ts`) |

**Le quatrième chemin, trouvé** : `packages/modules/storage/src/module.ts`
convertit `ModuleScope → FileOwner` **pour son propre compte** (`purge` et
`export`), sans passer par le `ownerOf` injecté. Les deux coïncident aujourd'hui
parce que `ownerOf` est l'identité sur un compte ; le jour où un écran d'avatar
d'organisation existera, ils pourront diverger et **rien ne rougirait** — la
suite injecte son propre `writeOwner`, et le seul filet qui voit le vrai
`ownerOf` est le parcours navigateur, qui n'exerce que l'affichage. Ce n'est pas
un défaut aujourd'hui : la purge est pilotée par le périmètre du registre, ce qui
est la forme juste. C'est un point à rouvrir avec l'écran d'organisation, et il
n'est écrit nulle part.

**F2 — la clé d'attente, éprouvée sur six cas.** Neutralisation « promotion
retirée, la clé présignée redevient la clé servie » : **5 cas rouges**, dont
`l'URL présignée ne désigne jamais ce qui est servi > rejouée après la
confirmation`. Les cas soumis, et ce sont ceux-là, pas « tous » :

| Cas | Mesuré |
|---|---|
| rejeu hostile **dans la fenêtre**, avant confirmation (mêmes longueur et type) | `confirm` **422 `content_mismatch`**, aucune ligne, objet d'attente retiré |
| rejeu de l'URL présignée **après** la promotion | le `PUT` répond 200, `GET /file` sert toujours les octets vérifiés |
| confirmer une clé **déjà servie** (`avatars/…`) | **404**, objet et ligne inchangés |
| deux confirmations **concurrentes de la même clé** | 200 / 200, **une** ligne, objet servi présent, octets servis = le PNG |
| deux confirmations **concurrentes de deux clés** | 200 / 200, une ligne, lecture 200, un seul objet servi restant |
| clé d'attente **d'un autre compte** | **404** pour l'attaquant, l'objet de la victime **survit**, et sa propre confirmation réussit ensuite |
| promotion **interrompue** (base coupée après `storage.write`) | levée, 0 ligne, objet d'attente supprimé, **objet servi orphelin** — voir S2 |

**F3 — déclenché pour de vrai.** Quatre `STORAGE_S3_*` renseignées,
`STORAGE_LOCAL_DIRECTORY` retirée, `next dev` : le processus **ne sert rien**
(`curl` : connexion refusée) et le message nomme les trois choses qui manquent —
l'origine attendue (`https://s3.eu-west-3.amazonaws.com`), le fichier
(`config/security.ts`) et le champ (`connect`). Neutralisation de la garde :
**1 cas rouge**. Neutralisation du refus du disque sous `NODE_ENV=production` :
**1 cas rouge**. `.env` du poste restauré à l'identique.

**F4 — `cache-control` remis à `public, max-age=31536000` : 1 cas rouge**
(0 avant le tour de correction). Restauré, arbre vérifié.

F5 et F6 sont fermés : les comptes de `packages/modules/storage/AGENTS.md` sont
désormais **dérivés** des tableaux (3 lignes / 3, 12 lignes / 12, 2 lignes / 2,
recomptés), et l'affectation morte du test de l'adapter a disparu.

### 10.3 Les deux décisions du tour

**La quatrième opération `write` du port — acceptée.** Le port reste un contrat
que toute implémentation peut tenir : déposer un objet est l'opération la plus
universelle d'un stockage, les deux implémentations livrées la portent, elle
passe par le même `run` que les autres (délai borné, reprises sur transitoires
seulement) et `PutObject` sur la même clé avec les mêmes octets est idempotent,
donc la reprise est sûre. Elle n'ouvre pas la porte que l'ADR 032 avait fermée :
les octets d'un téléversement ne traversent toujours pas l'application, ceux-ci
sont déjà en mémoire, plafonnés à deux mébioctets, et l'`AGENTS.md` des trois
paquets le dit. Le motif tient : la copie côté fournisseur rouvrait bien la
fenêtre entre la lecture vérifiée et la promotion. **Une réserve, en S1
ci-dessous** : l'en-tête du fichier de port, lui, annonce toujours « trois
opérations ».

**ADR 033 plutôt qu'un amendement de l'ADR 032 — forme correcte.** L'ADR 032 est
`accepted`, elle n'est ni modifiée ni contredite — 033 durcit la conséquence 1
de 032 sans la renverser, donc il n'y a rien à marquer `superseded`. Format MADR
respecté, quatre options écartées avec leur motif dont la copie côté fournisseur,
et les numéros 032 et 033 sont libres sur `dev` (qui s'arrête à 031).

**Le passage de 200 à 404 sur la seconde confirmation — assumé et encadré.**
L'invariant qui compte est asserté juste à côté (`tests/storage.test.ts:548` :
l'objet servi existe toujours, une seule ligne), le catalogue porte la phrase
(`avatar.error.invalid_key`, deux locales), et l'ADR l'écrit. Reste la petite
verrue de S4.

### 10.4 Le point déclaré : la politique de sécurité en mode développement

La vérification navigateur de l'implémenteur servait bien le build de production,
mais avec le **mode développement** de la politique. Ce que cela laisse
non mesuré est exactement l'écart entre les deux modes, et il tient en trois
directives : `'unsafe-eval'` dans `script-src`, `'unsafe-inline'` dans
`style-src`, et `report-uri` au lieu d'`upgrade-insecure-requests`. Les deux
directives que cette story exerce réellement — `img-src 'self'` pour l'avatar
servi, `connect-src 'self'` pour le `PUT` — sont **identiques dans les deux
modes** : elles ont donc bien été mesurées.

Restait le nonce de `style-src`, que le développement masque. Je l'ai mesuré à la
source, par une sonde Playwright temporaire (supprimée, arbre vérifié) sur
`/account` avec un avatar chargé : **aucun attribut `style`, aucun `<style>` sans
nonce, aucun `<script>` en ligne sans nonce, zéro `securitypolicyviolation`**, et
l'image réellement décodée (`naturalWidth = 1`). C'est la même mesure que celle
de s45 — dont le balayage statique, vérifié, ne porte que sur **deux** réponses,
l'accueil public et une 404, jamais `/account`.

Ce qui reste non mesuré de ce côté, et qui appartient à un humain : la page
`/account` servie sous `script-src 'strict-dynamic'` **sans** `'unsafe-eval'`, et
sous `upgrade-insecure-requests` — cette dernière étant inobservable en clair sur
`localhost`, où elle ferait échouer des sous-ressources pour une raison qui
n'aurait rien à voir avec la story. Un passage sur un déploiement https suffit.

### 10.5 Constats de cette seconde revue

Aucun bloquant. **Quatre mineurs et une observation, sur ce qui a été balayé.**

**S1 — mineur — l'en-tête du port annonce encore trois opérations.**
`packages/ports/src/storage.ts` ouvre sur « **Trois opérations, et le critère 1
de la story en fixe la liste** […] Il n'y en aura pas de quatrième par
commodité », au-dessus d'une interface qui en déclare quatre. La clause de sortie
citée par l'implémenteur — « le jour où l'un l'est, toutes les implémentations
doivent le porter » — est bien honorée, et `packages/ports/AGENTS.md` a été mis à
jour ; c'est le fichier de code qui reste faux. `AGENTS.md` racine : « les
documents partent avec le code qui les change ».

**S2 — mineur — un orphelin peut naître sous `avatars/`, et le remède documenté
ne vise que `pending/`.** Mesuré : base coupée entre `storage.write` et
`replaceAvatar`, l'objet servi reste dans le stockage, l'objet d'attente a déjà
été supprimé, aucune ligne ne le nomme. Il échappe donc à `purge` — qui n'efface
que les clés portées par des lignes — alors que le module déclare
`retention: { file: 'erase' }`. La classe existait avant ce tour et l'ADR 032 la
nomme ; ce qui est neuf, c'est que `.env.example`, l'ADR 033 et l'`AGENTS.md` du
module décrivent maintenant le remède comme « une expiration **du préfixe
`pending/`** », ce qui ne couvre pas ce cas-là. Fenêtre étroite, mais la phrase
est une affirmation d'exhaustivité de plus.

**S3 — mineur — sans base, `tests/storage.test.ts` échoue au lieu de s'ignorer.**
Mesuré en arrêtant PostgreSQL : `le module coupé ne laisse aucune trace >
n'est ni purgé ni exporté quand il est coupé` lève
`TypeError: Cannot read properties of undefined (reading 'db')`. Ce `describe`
n'est pas `runIf(databaseReachable)` — à raison, il parle de modularité — mais
la doublure de contrat `authStandIn.purge` lit `connection`. La convention du
dépôt est ailleurs celle de `tests/organizations.test.ts`, qui porte un cas
explicite « la base de données de la suite est joignable ». La CI a une base :
rien ne casse là-bas, mais le prochain agent sans Docker lira une pile
incompréhensible.

**S4 — mineur — un `confirm` rejoué affiche une erreur alors que l'avatar a
changé.** `avatar-form.tsx` traduit le 404 en « Cet envoi n'est plus valide.
Réessayez. ». Faible portée : le bouton est désactivé pendant l'envoi et un
`POST` n'est pas rejoué tout seul. À garder en tête le jour où un rejeu
automatique apparaîtra.

**S5 — mineur, étiquette — le tableau de mutations de
`packages/modules/storage/AGENTS.md` nomme « `keyBelongsTo` retiré de
`confirmAvatar` »**, alors que `confirmAvatar` appelle désormais `servedKeyOf`.
Le compte (1) est juste — la neutralisation équivalente que j'ai posée donne 1
rouge dans ce fichier, plus 2 dans le `domain`. C'est le nom qui a vieilli.

**Observation — le quatrième chemin de la section 10.2**, à rouvrir avec l'écran
d'avatar d'organisation, et à écrire quelque part avant.

### 10.6 Ce que je n'ai pas pu vérifier

- **aucun seau réel n'a été contacté.** Le comportement d'un vrai S3/R2 face à
  une signature dont les en-têtes ne correspondent pas, ses codes HTTP réels, et
  le fait que le navigateur laisse passer `content-length` — en-tête interdit à
  `fetch`, donc posé par le navigateur lui-même — restent **inférés** du bac à
  sable de la recherche. Geste humain : le régime « clés de test réelles », sur
  commande explicite, avant le ship ;
- **`config/security.ts` avec une origine tierce déclarée n'a jamais été
  rendu.** J'ai mesuré le **refus** de démarrer, pas le succès : personne n'a vu
  un `PUT` navigateur vers une origine tierce passer sous cette politique ;
- **le mode production de la politique sur `/account`** — mesuré à la source,
  pas à la sanction (section 10.4) ;
- **aucun écran d'avatar d'organisation.** Le critère 5 est tenu par le contrôle
  de périmètre de `readFile`, éprouvé avec des propriétaires injectés
  (`tests/storage.test.ts:401`), mais **aucun chemin livré n'écrit un fichier
  d'organisation** : le critère est aujourd'hui vrai à vide ;
- **la concurrence a été exercée en processus unique** (deux confirmations en vol
  dans le même nœud, sur la vraie base et le vrai disque). Deux instances
  distinctes derrière le même PostgreSQL n'ont pas été essayées ; le verrou est
  consultatif et transactionnel, donc il devrait tenir, mais ce « devrait » n'est
  pas une mesure ;
- **la suppression de compte réelle n'existe pas** (s34) : `purgeModules` a été
  appelée directement ;
- **pas de limitation de débit** (s28) : un compte authentifié peut appeler
  `presign` en boucle et déposer des objets d'attente ;
- **le rendu mobile et le thème sombre** de la carte « Photo de profil », et la
  conformité au mockup `docs/designs/s18-*.html`, n'ont pas été regardés.

### 10.7 Verdict de la seconde revue

Les quatre constats du premier tour sont fermés, et chacun avec un filet qui
mord : je les ai neutralisés moi-même et compté le rouge. Les six scénarios
d'attaque sur la clé d'attente se comportent comme l'ADR 033 le prétend, y
compris la confirmation concurrente et le vol de la clé d'attente d'autrui. Le
refus de démarrer a été déclenché dans la vraie commande et nomme ce qui manque.
La quatrième opération du port et l'ADR 033 sont deux décisions correctement
formées. Le mode de politique de sécurité de la vérification navigateur a été
remesuré à la source, et l'écart restant est nommé.

Ce qui reste tient en cinq points mineurs, dont trois sont de la documentation
qui a vieilli d'un tour, un est une fenêtre de panne étroite dont le remède écrit
ne nomme qu'un préfixe sur deux, et un est une pile de test illisible sans base.
Aucun ne corrompt quoi que ce soit en silence.

## 11. Clôture des cinq mineurs de la seconde revue

Tour de correction sur `6d5d647`, un commit de plus : `1edfd5e`. Rien d'autre
n'a été touché — ni `playwright.config.ts`, ni `docs/STATE.md`, ni
`config/security.ts`, ni les ADR, qui sont acceptées.

| Constat | Ce qui a été fait |
|---|---|
| **S1** en-tête du port | `packages/ports/src/storage.ts` annonce quatre opérations, et dit pourquoi la quatrième n'est pas une commodité : demander la promotion au fournisseur (copie d'objet à objet) rouvrirait la fenêtre entre la lecture vérifiée et l'écriture — un rejeu de l'URL présignée remplacerait la source, et la copie promouvrait des octets que personne n'a regardés. La garde n'est pas levée : la cinquième opération se justifiera comme celle-ci, ou n'existera pas |
| **S2** portée du remède | `packages/modules/storage/AGENTS.md` et `.env.example` portent un tableau à deux lignes : `pending/` prend une expiration d'âge du préfixe entier ; `avatars/`, où une **promotion interrompue** laisse un objet servi que rien ne nomme, n'a **aucun remède aujourd'hui** — une expiration d'âge y ramasserait les avatars légitimes, et la réconciliation qu'il demande (`docs/reliability.md` §5) n'existe pas dans ce dépôt |
| **S3** pile illisible sans base | la doublure d'`auth` ne lit plus la connexion ; les cas de modularité s'exécutent sans base, et un cas explicite — « la base de données de la suite est joignable » — échoue en nommant `docker compose up -d`. Même forme que `tests/organizations.test.ts` |
| **S4** message d'un rejeu | le refus reste un 404 (ADR 033, conséquence 3 inchangée) ; le **corps** distingue `already_confirmed` de `not_found`, et l'écran ne dit plus « Cet envoi n'est plus valide » quand l'avatar a changé |
| **S5** étiquette de mutation | la ligne cite la neutralisation réellement rejouable — « garde de périmètre retirée de `confirmAvatar` (`servedKeyOf` contournée) » — et son rouge a été recompté, pas recopié |

### 11.1 L'oracle, et pourquoi il n'y en a pas

`already_confirmed` n'est rendu que pour une clé qui a franchi `servedKeyOf` —
donc une clé du **périmètre de l'appelant** — *et* dont la clé servie est celle
que **sa propre ligne** porte. Une clé inventée sous son propre préfixe, comme
la clé d'attente d'un autre compte, reçoit le même `{ error: 'not_found' }`. Le
statut HTTP, lui, est identique dans les trois cas : rien ne se déduit du code
de réponse (`docs/security.md` §3).

### 11.2 Les mutations de ce tour, et leur rouge

Chacune a été restaurée dans la commande qui la posait, et l'empreinte du
fichier vérifiée identique avant/après.

| Neutralisation | Configuration | Cas rouges |
|---|---|---|
| `already_confirmed` retiré : tout objet d'attente absent redevient `not_found` | base joignable | **1** (`tests/storage.test.ts` › confirmer deux fois la même clé) |
| `already_confirmed` rendu sans comparer la clé servie de la ligne | base joignable | **1** (`tests/storage.test.ts` › une clé d'attente jamais déposée…) |
| branche du rejeu retirée d'`avatar-form.tsx` | base joignable | **1 parcours** (`e2e/storage.spec.ts` › un envoi rejoué ne dit pas le contraire…) |
| garde `!databaseReachable` retirée de la doublure d'`auth` | **sans base** | **1** (`tests/storage.test.ts` › n'est ni purgé ni exporté quand il est coupé), en plus de la garde d'inertie qui est rouge par construction dans cette configuration |
| garde de périmètre retirée de `confirmAvatar` (`servedKeyOf` contournée) — **remesure de S5** | base joignable | **1** (`tests/storage.test.ts` › refuse de confirmer une clé qui n'est pas dans le périmètre de l'appelant) ; **0** dans le `domain`, dont la règle n'est pas touchée |

### 11.3 Ce qui a été exécuté, dans les deux configurations

| Commande | Module activé | Module coupé |
|---|---|---|
| `pnpm typecheck --force` | vert (19 tâches, 0 en cache) | vert (19, 0 en cache) |
| `pnpm lint --max-warnings=0` | vert | vert |
| `pnpm test` | **1 230** passés, 2 ignorés, 37 fichiers | 1 230 passés |
| `E2E_PORT=3118 pnpm test:e2e` | **64** passés, 6 ignorés | 60 passés, 10 ignorés |
| `pnpm build --force` | vert (0 en cache) | vert (0 en cache) |
| `pnpm run audit` | 1 avis, aucun non couvert au seuil « élevé » | idem |

`pnpm ks toggle storage` aller-retour : les empreintes de `config/features.ts`,
`generated/schema/index.ts` et `generated/schema/storage.ts` sont identiques
avant et après, arbre propre.

### 11.4 Ce qui reste ouvert, et qui est maintenant écrit

- **le quatrième chemin d'appartenance** — `src/module.ts` convertit
  `ModuleScope → FileOwner` pour son propre compte (`purge`, `export`), sans le
  `ownerOf` injecté. Correct aujourd'hui, non couvert par un filet. Il est écrit
  dans `packages/modules/storage/AGENTS.md`, section « À lire avant d'écrire
  l'écran d'avatar d'organisation », avec le cas à poser ce jour-là ;
- **le critère 5, vrai à vide** — aucun chemin livré n'écrit un fichier
  d'organisation : la propriété est éprouvée sur des propriétaires **injectés**,
  ce qui n'est pas la même chose qu'éprouvée en usage. Écrit au même endroit ;
- **l'orphelin sous `avatars/`** — sans remède aujourd'hui. La forme qui le
  rendrait impossible plutôt que ramassable (enregistrer la ligne **avant** de
  promouvoir, pour que la panne laisse une ligne visible plutôt qu'un objet
  invisible) est nommée dans l'`AGENTS.md` du module et **non implémentée** :
  elle déplace la fenêtre et appartient à un ADR ;
- **les ADR 032 et 033 n'ont pas été modifiées.** Elles sont `accepted`, donc
  immuables : elles nomment la dette du côté `pending/`, et la portée réelle
  vit dans les deux fichiers vers lesquels l'ADR 033 renvoie déjà pour le geste
  d'exploitation. Un ADR de correction n'a pas été ouvert : ce tour ne prend
  aucune décision structurelle ;
- **le message du rejeu n'a de filet qu'au navigateur.** Le dépôt n'a pas
  d'environnement de rendu de composants, et il n'en gagne pas un pour ce cas :
  le couple « 404 + `already_confirmed` » est fixé côté nœud, ce que l'écran en
  fait est fixé par le parcours ;
- tout ce que la section 10.6 nomme reste vrai : aucun seau réel contacté, pas
  de limitation de débit, pas de suppression de compte réelle, mobile et thème
  sombre non regardés.

Max severity: minor
Ship allowed: yes
