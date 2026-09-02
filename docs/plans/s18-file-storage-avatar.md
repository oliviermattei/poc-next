---
story: s18-file-storage-avatar
validated: yes
---

# Plan — s18-file-storage-avatar

Recherche : `docs/research/s18-file-storage-avatar.md`.
Design : `docs/designs/s18-file-storage-avatar.md` (+ `.html`).
Décision structurante ouverte par cette story : **ADR 032** — lecture servie par
l'application, écriture directe au stockage.

## Socles nommés

`docs/security.md` **§1** (politique de sécurité du contenu — `img-src` et
`connect-src`, §5 de la recherche), **§3** (autorisation côté serveur, 404 et
non 403), **§4** (Zod à la frontière, type MIME et taille contrôlés côté serveur
avant l'émission de l'URL présignée, jamais l'extension du client), **§5**
(aucun secret dans une URL, dans un journal ni dans une réponse d'erreur ;
validation d'environnement au démarrage nommant la variable).

`docs/reliability.md` **§1** (rejouable : deux téléversements ne laissent pas
deux objets ; la purge est idempotente), **§2** (dégradation : un stockage
absent ne casse pas l'application ; mode local **explicite**, jamais déduit de
`NODE_ENV`), **§3** (délai d'attente explicite, recul exponentiel dispersé et
plafonné, transitoires seulement).

`AGENTS.md` racine : un `AGENTS.md` par package neuf ; aucune affirmation
d'exhaustivité ; une règle sans commande est de la documentation.

## Tâches

- [x] **1. Le port `Storage`.** `packages/ports/src/storage.ts` : `presignUpload`,
  `read`, `remove`, chacune rendant un résultat discriminé
  (`{ok:true,…} | {ok:false,error}`), `StorageErrorCode` avec sa partition
  transitoire/définitive, `StorageLogRecord` **fermé** (aucun champ où mettre une
  clé d'objet, un octet ou un secret). Export depuis le baril,
  `packages/ports/AGENTS.md` mis à jour. *Types seuls : aucun test ici, les
  garanties se prouvent chez les implémentations — c'est la règle écrite dans
  l'`AGENTS.md` de ce package.*

- [x] **2. L'adapter S3/R2.** `packages/adapters/s3` : `createS3Storage` sur
  `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, `FetchHttpHandler`
  imposé (§3 de la recherche), `maxAttempts: 1` sur le client, délai explicite,
  reprises en recul dispersé plafonné sur transitoires uniquement, messages
  assainis. **Test-first**, réseau doublé par `globalThis.fetch`, SDK réel :
  l'URL présignée porte une échéance et lie type et taille ; une erreur 500 est
  rejouée, une 403 ne l'est pas ; un fournisseur muet rend `timeout` sans lever.
  *Mutation : classer tout transitoire ; retirer la course du délai ; retirer la
  dispersion.*

- [x] **3. Le stockage local, outil de développement.** `packages/storage-testing` :
  `createLocalDiskStorage` — écrit sous un dossier **injecté**, présigne vers
  **notre propre origine** avec échéance et signature HMAC, refuse une clé qui
  sort du dossier. **Test-first** : une clé portant `../` n'écrit pas hors du
  dossier ; une URL expirée est refusée ; une URL signée pour une clé ne vaut
  pas pour une autre ; un disque en échec **dégrade** au lieu de lever.
  *Mutation : retirer la vérification d'échéance ; retirer la clé de la charge
  signée.*

- [x] **4. Le `domain` du module.** `packages/modules/storage/src/domain/` :
  signatures binaires (PNG, JPEG, WebP — et **rien d'autre**, SVG compris),
  taille maximale, construction de la clé d'objet, appartenance d'une clé à un
  périmètre. **Test-first** : un `image/png` déclaré sur des octets `<svg…>` est
  refusé ; une clé hors du préfixe de l'appelant est refusée ; une clé portant
  `..` est refusée. *Mutation : accepter le type déclaré ; retirer le contrôle
  de préfixe.*

- [x] **5. `application` + `infrastructure` du module.** Cas d'usage
  `presignAvatarUpload`, `confirmAvatarUpload`, `removeAvatar`, `readFile`,
  `avatarOf`, `purge`, `export` ; repository Drizzle ; schéma `storage_file`
  (unique sur `(owner_kind, owner_id, purpose)` — c'est la base qui interdit le
  doublon, jamais une vérification préalable) ; migration générée. **La
  confirmation lit les octets stockés** et refuse ce qui n'est pas une des trois
  signatures, en supprimant l'objet. **Le remplacement supprime l'objet
  précédent.** **La purge supprime l'objet, pas seulement la ligne.**

- [x] **6. `presentation` du module.** Cinq routes déclarées une par une avec
  leur protection : `presign`, `confirm`, `remove`, `file` (lecture), et
  `local-upload` — cette dernière **404 quand le mode local n'est pas monté**.
  404 et jamais 403 pour le fichier d'un autre périmètre. `module.ts` :
  `dataCategories: ['file']`, `retention: { file: 'erase' }`, `purge`, `export`.
  `AGENTS.md` du module.

- [x] **7. Le composant `Avatar`.** `packages/ui` : `Avatar`, `AvatarImage`,
  `AvatarFallback` sur `@radix-ui/react-avatar`, deux tailles. *Tâche de
  présentation : vérification visuelle, pas de test synthétique.*

- [x] **8. Le montage dans l'application.** `apps/web/lib/storage-config.ts` (la
  **règle** : un seau complet, ou `STORAGE_LOCAL_DIRECTORY`, jamais les deux,
  jamais rien — et **seulement si le module est activé**),
  `apps/web/lib/storage.ts` (le montage), garde de démarrage dans
  `next.config.ts`, `lib/module-services.ts`. Variables au schéma de
  `@repo/config` + `.env.example`.

- [x] **9. Les écrans.** `account-menu.tsx` et `account/page.tsx` rendent
  l'avatar ; `app/account/avatar-form.tsx` fait les trois appels (présigner,
  téléverser, confirmer). `<form method="post">` écrit en toutes lettres,
  bouton désactivé avant hydratation. Fixtures de `tests/rendered-text.test.ts`
  mises à jour.

- [x] **10. Les cas de câblage et le parcours.** `tests/storage.test.ts` (le
  fichier neuf de la racine) : 404 sur le fichier d'un autre périmètre, membre
  d'organisation autorisé, purge qui supprime **l'objet**, export qui liste,
  rejeu du téléversement, module coupé. `e2e/storage.spec.ts` : téléverser,
  voir, remplacer, retirer, au navigateur.

- [x] **11. ADR 032 et les documents.** `docs/decisions/032-…`, `.env.example`,
  `apps/web/AGENTS.md`, `packages/ports/AGENTS.md`, `config/features.ts`,
  `generated/`.

## Mutations annoncées

| Invariant | Neutralisation prévue |
|---|---|
| type réel vérifié | `detectImageType` → rendre le type déclaré |
| taille réelle vérifiée | retirer le contrôle de taille à la confirmation |
| clé confinée au périmètre | retirer `keyBelongsToScope` de la confirmation |
| 404 et non 403 | rendre 403 sur le fichier d'un autre périmètre |
| remplacement sans orphelin | ne plus supprimer l'objet précédent |
| purge effective | purge qui supprime la ligne sans l'objet |
| mode local explicite | faire retomber la configuration sur le local en l'absence de seau |
| URL présignée bornée | retirer `expiresIn` / la vérification d'échéance locale |
| reprises bornées | classer toutes les erreurs transitoires |
