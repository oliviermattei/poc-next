# Recherche — s16-invite-members

Worktree `/Users/olivier/www/boilerplate/.claude/worktrees/agent-a92452e436f2c8543`,
branche `feature/s16-invite-members`, base `cf9f480`, base Postgres `s16`,
parcours sur `E2E_PORT=3116`.

Tout ce qui suit a été lu **dans les fichiers du dépôt et dans les paquets
installés**, jamais dans une documentation en ligne. Les numéros de ligne sont
ceux de la base `cf9f480`. Ce document dit ce qui a été balayé et nomme les cas ;
il ne prétend nulle part à l'exhaustivité.

---

## 1. Ce que la story demande, et où chaque critère atterrit

`docs/stories.md`, chapitre `s16-invite-members`, sept critères. Dépendances
déclarées : `s15-organizations` (livrée, revue `none`, fusionnée en `9bb3309`) et
`s06-transactional-emails` (livrée : port `Mailer`, capture locale, rendu React
Email).

| Critère | Où il se joue |
|---|---|
| 1. invitation envoyée par email, visible dans les invitations en attente | table `organization_invitation`, port `Mailer`, écran `/organizations` |
| 2. acceptation par un compte existant / enchaînement inscription pour un nouveau | écran `/invitations/accept`, redirection vers `/sign-in?next=…` et `/sign-up` |
| 3. expirée / déjà acceptée / révoquée ⇒ erreur explicite, aucun membre ajouté | prédicat de la consommation atomique + statut relu pour le message |
| 4. email déjà membre ⇒ refus explicite | règle du `domain` + lecture périmétrée des membres |
| 5. invitation en attente révocable et renvoyable | deux routes, un jeton **tourné** au renvoi |
| 6. membre retirable, accès perdu immédiatement | `delete` périmétré + jointure d'appartenance déjà posée en s15 |
| 7. dernier propriétaire non retirable | règle pure **et** prédicat SQL atomique |

Notes agentiques de la story, reprises telles quelles : « son état off est celui
de s15, elle n'en porte pas un second » (donc **aucun nouveau module**, aucune
nouvelle entrée dans `config/features.ts`), « le lien d'invitation est un jeton à
usage unique et à durée limitée, distinct de la session », « le retrait d'un
membre doit invalider ses sessions actives sur cette organisation ».

---

## 2. Ce que s15 a réellement livré, et ce que sa revue a mesuré

`docs/reviews/s15-organizations.md` est le document décisif : il dit lesquels des
invariants revendiqués sont tenus par une commande et lesquels ne l'étaient pas.

### 2.1 Ce qui est tenu, et par quoi

| Invariant | Ce qui le tient | Ce que s16 en hérite |
|---|---|---|
| 404 et jamais 403 | `membershipOf` porte les deux conditions dans **un seul** ordre ; `null` ne distingue pas « pas membre » de « n'existe pas » | toute route de s16 passe par `authorizeOrganization` avant tout |
| une écriture ne reçoit jamais un identifiant nu | marque de type non exportée sur `OrganizationAccess`, produite par `authorizeOrganization` seul (`application/organization-access.ts` l. 33-46) | les écritures de s16 exigent le même porteur |
| une lecture passe par la porte unique | `eslint.config.ts` l. 390-408 : `select`, `from`, `execute` refusés dans tout `packages/modules/organizations/src` **sauf** `infrastructure/scoped-reads.ts` | toute lecture de s16 s'écrit dans ce fichier |
| un membre retiré cesse de résoudre | `activeOrganizationIdOf` joint la sélection à `organization_member` sur le **compte** (`scoped-reads.ts` l. 133-148) | **le critère 6 est déjà à moitié tenu** — voir §6 |
| identifiants réservés dérivés des écrans servis | `tests/organizations.test.ts` l. 597-611 lit `apps/web/app` sur le disque | un écran neuf **doit** entrer dans `APPLICATION_SEGMENTS` |

### 2.2 La limite de la porte de lecture, écrite là où elle se lit

`scoped-reads.ts` l. 27-31 et `eslint.config.ts` l. 362-369 le disent tous les
deux : **la règle de lint ne lit pas le SQL**. À l'intérieur de la porte, rien
n'oblige un prédicat à porter le propriétaire ; c'est la mutation qui l'éprouve.
Conséquence directe pour s16 : chaque lecture ajoutée à `scoped-reads.ts` devra
être **mutée** (retirer le prédicat de propriétaire) et faire rougir un cas
nommé, sans quoi la garde ne dit rien d'elle.

Second angle mort déjà écrit : un appel dont le nom de méthode n'est pas visible
à la syntaxe (`const { select } = db`) échappe au sélecteur. À ne pas écrire.

Troisième conséquence, **piège d'écriture** : le sélecteur interdit tout appel de
méthode nommée `select`, `from` ou `execute` dans le module. `Array.from(…)` en
fait partie. Il faudra employer une autre forme (`[...iterable]`, `.map`).

### 2.3 Ce que la revue a laissé ouvert, et qui touche s16

- **F7 (fermé)** : `current.none` existe désormais, précisément parce que « c'est
  l'état d'un membre retiré et celui d'un compte invité (s16) ». Un compte qui a
  des appartenances mais aucune sélection valide voit « Choisir une
  organisation ». s16 crée massivement cet état : un invité qui accepte a une
  appartenance et **aucune** sélection active. Décision prise ici : **accepter
  une invitation pose l'organisation acceptée comme organisation courante** —
  c'est le seul comportement qui ne laisse pas l'invité sur un écran qui l'invite
  à choisir ce qu'il vient d'accepter. La pose passe par `setActiveOrganization`,
  qui exige un `OrganizationAccess`, donc par une relecture de l'appartenance
  qu'on vient d'écrire (le patron de `createOrganization`).
- **ADR 025, « à surveiller »** : la sélection active a le **compte** pour clé
  primaire. Une écriture dérivée de `dataOwnerOf` peut atterrir dans
  l'organisation basculée dans un autre onglet. s16 écrit de la donnée
  d'organisation depuis un écran ⇒ **toutes ses écritures prennent
  l'`organizationId` du formulaire affiché**, jamais `dataOwnerOf`. C'est déjà la
  forme de `renameOrganization` (champ caché + relecture de l'appartenance) ;
  s16 la reprend sans exception.

---

## 3. La rotation de l'identifiant de session : mesurée, et le résultat est un blocage nommé

`docs/security.md` §2 : « Rotation de l'identifiant de session à l'élévation de
privilège : **connexion, validation du second facteur, fin d'impersonation** ».
L'énumération ne nomme ni la bascule d'organisation ni l'acceptation d'une
invitation. ADR 025 tranche la première : « la rotation … est **sans objet** : le
jeu de droits attaché à une session est identique avant et après, puisque
l'appartenance est relue à chaque requête ».

**Ce qui a été vérifié ici, dans le code :**

1. `ModuleSession` (`packages/core/src/module.ts` l. 57-60) porte `userId` et
   `roles`, rien d'autre. Aucune autorité organisationnelle n'y transite.
2. `auth_session` n'a aucune colonne d'organisation — le plugin `organization` de
   Better Auth n'est pas monté (ADR 025), mesuré à nouveau sur la base `s16`
   fraîchement migrée.
3. L'appartenance est relue **à chaque requête** par `membershipOf` (routes) et
   par `activeOrganizationIdOf` (résolution du propriétaire), toutes deux jointes
   sur le compte.

Donc : après acceptation, l'identifiant de session existant gagne l'accès parce
que la **ligne** `organization_member` existe, pas parce que le jeton porte
quelque chose. Faire tourner l'identifiant ne retirerait ni n'ajouterait aucun
droit. La preuve opposable retenue pour cette story est la **réciproque**, qui est
observable : *le même identifiant de session perd l'accès à l'instant où la ligne
disparaît* (critère 6). Un jeton qui aurait mis en cache une autorité ne le
ferait pas.

**Blocage nommé, et non contourné.** Faire tourner l'identifiant de session
depuis le module `organizations` exigerait un point d'entrée dans le module
`auth` — `AuthService` (`packages/modules/auth/src/application/auth-service.ts`)
n'expose que `handle`, `handleOAuthCallback`, `changePassword`, `resolveSession`,
`resolveSessionId`, `localeOf`, `oauthProviders`, `useCases`, `policy` ; aucune
rotation. Grep sur `packages/modules/auth/src` : les seules occurrences sont
`revokeForUser` (révocation d'une session nommée) et le drapeau
`revokeOtherSessions` **imposé** au changement de mot de passe. La consigne de
cette voie est explicite : ne pas prendre de point d'entrée dans `auth`, s'arrêter
et le dire. C'est fait, et l'arbitrage est consigné dans un ADR (§10).

---

## 4. Le jeton d'invitation : ce que le dépôt a déjà payé

`packages/modules/auth/src/infrastructure/token-factory.ts` documente les deux
propriétés et **la limite mesurée** : le lien de réinitialisation de Better Auth
est écrit **en clair** en base (`better-auth@1.7.2`,
`dist/api/routes/password.mjs`), et c'est un arbitrage accepté et borné. s07 a
donc déjà été prise avec un jeton non haché ; s16 n'a aucune raison de refaire ce
chemin puisqu'elle émet elle-même son jeton.

Forme retenue, copiée sur ce qui existe :

- `randomBytes(32).toString('base64url')` — 256 bits, générateur cryptographique
  du système ;
- stocké en `sha256` base64url, sans sel ni étirement : l'entrée a déjà 256 bits
  d'entropie, un KDF lent n'y ajoute rien (raison écrite dans
  `token-factory.ts` l. 17-20) ;
- `node:crypto` est autorisé dans `infrastructure/` du module
  (`packages/modules/organizations/AGENTS.md`, « Imports autorisés »).

**Ce que s16 ne réutilise pas** : `auth_verification` et `TokenPurpose`
appartiennent au module `auth`. Une invitation vit dans `organization_invitation`
— sinon la table du module `auth` porterait de la donnée d'organisation, ce que
`packages/db/src/references.ts` refuse déjà et que l'ADR 025 vient de trancher
pour la session.

**Consommation atomique, sans fenêtre.** L'ordre est un `update … where
token_hash = ? and accepted_at is null and revoked_at is null and expires_at >
now() returning …`. Un second appel concurrent trouve zéro ligne. C'est la même
garantie que `tokens.consume` d'`auth` (« consommer d'abord rend l'opération
atomique », `auth-use-cases.ts` l. 190-195), obtenue ici par le prédicat plutôt
que par une suppression — **parce que le critère 3 exige de distinguer expirée,
révoquée et déjà acceptée** pour le message. Effacer l'empreinte à la
consommation rendrait les trois indiscernables.

L'empreinte reste donc en base après consommation. Ce n'est pas une fuite : c'est
un `sha256` de 256 bits d'entropie, et la ligne ne peut plus être consommée
(`accepted_at is not null`). La mutation qui l'éprouve est écrite au plan.

---

## 5. Le port `Mailer`, tel qu'il se branche

- `packages/ports/src/mailer.ts` : `send(input): Promise<SendEmailResult>`,
  **ne lève jamais**, rend `{ok:true,id}` ou `{ok:false,error}`. Le package ne
  contient que des types — un module peut en dépendre sans traîner de SDK.
- L'identifiant de template est **qualifié par module** :
  `packages/emails/src/render.ts` l. 30-32, `qualifyEmailTemplateId(moduleId,
  templateId)`. `auth` appelle donc `template: 'auth.verify-email'`. s16 appellera
  `'organizations.invitation'`.
- Le contrat de module indexe `emails[].locales` par les locales de `messages`
  (`packages/core/src/module.ts` l. 122-131 et 308) : **un template livré dans
  moins de locales que le module ne compile pas**. `organizations` livre `fr` et
  `en`, le template devra livrer les deux.
- La locale d'un destinataire inconnu est **celle du site**. C'est écrit deux
  fois : `auth-service.ts` l. 52-59 (« `null` est le destinataire dont rien n'est
  connu — **invitation**, guest checkout, liste d'attente : il reçoit la locale
  par défaut du site ») et `apps/web/lib/auth.ts` l. 98-106. s16 reçoit donc
  `defaultLocale` du point de composition, et ne lit ni cookie ni en-tête.
- Le mode local est un **opt-in** : `EMAIL_LOCAL_CAPTURE=1`
  (`apps/web/lib/mailer-config.ts`), jamais déduit. Le `.env` de ce worktree le
  porte, la capture écrit dans `apps/web/.mail` — c'est là que
  `e2e/support/account.ts` lit les liens.
- `apps/web/AGENTS.md` réserve l'import de `@repo/ports` et de
  `@repo/adapter-resend` à `lib/mailer.ts`. s16 n'y touche pas : `lib/auth.ts`
  passe déjà `createAppMailer()` au module `auth` ; `lib/organizations.ts` fera
  de même, en important `createAppMailer` depuis `./mailer` — pas le port.

**L'URL publique.** `apps/web/lib/auth-config.ts` exige `APP_URL` de ce qui monte
l'authentification, et le commentaire d'`apps/web/AGENTS.md` dit pourquoi : « la
**déduire** de l'en-tête `Host` … laisse un attaquant faire pointer un lien de
réinitialisation vers son propre domaine ». `lib/organizations.ts` réutilisera
`resolveAuthConfig(getEnv()).appUrl` — pas une seconde variable, pas une seconde
règle qui pourrait diverger.

**Ce que fait un envoi qui échoue.** `docs/reliability.md` §2 : « Toute opération
multi-étapes est **reprenable** : soit elle est atomique, soit elle laisse un état
explicite permettant de la rejouer. » L'invitation est donc **écrite d'abord**,
l'email envoyé ensuite ; un échec d'envoi rend un refus nommé
(`?error=email_failed`) et laisse l'invitation **en attente**, donc renvoyable
par la route de renvoi. C'est l'état explicite exigé, et c'est aussi ce qui rend
le critère 1 vrai quand le fournisseur est en panne.

---

## 6. Le critère 6, à moitié livré par s15 — et l'autre moitié

« Un membre peut être retiré de l'organisation et perd **immédiatement** l'accès
à ses données. »

Ce que s15 a déjà mesuré (`tests/organizations.test.ts` l. 441-486, cas « cesse de
résoudre vers une organisation qu'on a quittée ») : la ligne de sélection
survit, la **lecture** porte l'appartenance, `activeOrganizationId` rend `null`
et `dataOwnerOf` retombe sur `{kind:'user'}`. Ce cas pose déjà le second membre
et supprime son appartenance **à la main, en SQL** — c'est-à-dire exactement le
geste que s16 doit maintenant offrir par une route.

Ce que s16 ajoute donc :

1. la route qui fait ce geste, périmétrée (`organization_id` **et** `user_id`
   dans un seul ordre) ;
2. la règle du dernier propriétaire ;
3. la preuve que l'accès tombe pour la **même session**, sans reconnexion — c'est
   la note agentique « le retrait d'un membre doit invalider ses sessions actives
   sur cette organisation », et c'est ce qui remplace la rotation (§3) : il n'y a
   pas de session « sur cette organisation », il y a une appartenance relue.

**Le dernier propriétaire : une seule décision, et une fenêtre nommée.** Une
lecture des membres qui déciderait, suivie d'un `delete` qui obéit, ferait deux
vérités — et la première à diverger serait celle qui écrit. Le prédicat du
`delete` porte donc lui-même la condition, en une seule instruction :

```
delete from organization_member
where organization_id = ? and user_id = ?
  and (role <> 'owner'
       or (select count(*) from organization_member m
           where m.organization_id = ? and m.role = 'owner') > 1)
```

Écrit en Drizzle avec `sql\`\`` **dans le `where`** — pas un appel `.select(`,
`.from(` ni `.execute(`, donc compatible avec la porte de lecture de s15
(mesuré : le sélecteur ESLint vise `CallExpression[callee.property.name=…]`,
`eslint.config.ts` l. 381-388). La règle pure du `domain` existe malgré tout,
mais elle ne décide pas : elle **nomme** le refus une fois que l'ordre a rendu
zéro ligne, et elle dit à l'écran s'il doit offrir l'action. Un seul point de
décision, donc : `rowCount === 0` ⇒ refus.

**Ce que ce prédicat ne tient pas, et il faut le dire.** Sous l'isolation par
défaut de PostgreSQL (`read committed`), deux retraits **simultanés** de deux
propriétaires distincts évaluent chacun la sous-requête sur l'état d'avant
l'autre : les deux peuvent passer. Le fermer demanderait un verrou de ligne,
c'est-à-dire une lecture dans le chemin d'écriture, que la porte de lecture de
s15 refuse — et aucun test d'ici n'exerce cette course. La fenêtre d'une requête
isolée, elle, est bien fermée : c'est ce que la mutation éprouve.

---

## 7. Limitation de débit : ce que le dépôt a déjà décidé, et ce que s16 fait

`docs/architecture.md` l. 170, écrit noir sur blanc : « **La limitation de débit
arrive en s28.** Tous les états livrables antérieurs exposent inscription,
**invitations**, téléversement et checkout anonyme sans limite ». `docs/security.md`
§7 renvoie également à s28, et pour un **point d'entrée public** — la route
d'invitation est `authenticated`.

s16 ne préempte donc pas s28 et n'invente pas de port de limitation. Elle pose ce
qui manque réellement : **un quota d'émission par organisation**, parce qu'une
invitation est un moyen d'expédier du courrier depuis le domaine du produit et
que la réputation d'envoi est le seul actif qu'on ne récupère pas.

Forme : au plus `N` invitations créées par organisation sur une fenêtre glissante
d'une heure, comptées **dans la table des invitations elle-même** — donc partagé
entre instances, sans nouvelle table et sans nouvelle dépendance. La lecture
prend l'accès en premier paramètre et vit dans `scoped-reads.ts`.

**La limite, écrite plutôt que sous-entendue** : c'est une vérification suivie
d'une écriture, donc deux requêtes concurrentes peuvent chacune passer le seuil.
Le dépassement est borné par la concurrence, pas par le temps ; le contrôle vise
un envoi massif, pas une course. Rendre le quota exact demanderait de verrouiller
la ligne d'organisation dans la transaction d'écriture, c'est-à-dire une lecture
`for update` **dans le fichier d'écriture** — ce que la porte de lecture de s15
refuse, et à raison. L'écart est assumé et nommé ici ; `docs/reliability.md` §1,
qui interdit « une simple vérification préalable », vise l'**idempotence** d'une
écriture déclenchée de l'extérieur, et celle-ci est tenue autrement (§8).

---

## 8. Idempotence et rejeu

| Ce qui vient de l'extérieur | Ce qui tient le rejeu |
|---|---|
| accepter deux fois le même lien | le prédicat de la consommation atomique : la seconde trouve zéro ligne, et l'appartenance est écrite en `onConflictDoNothing` sur `organization_member_unique` (contrainte posée par s15, `schema.ts` l. 68-72, avec le commentaire « sans cette contrainte, une invitation rejouée (s16) doublerait la ligne ») |
| inviter deux fois la même adresse | index unique **partiel** sur `(organization_id, email)` restreint aux invitations ni acceptées ni révoquées : la base décide, jamais un `select` préalable (`docs/reliability.md` §1, et le précédent `organization_slug_key`). La violation est traduite en refus nommé, comme `slug_unavailable` l'est |
| renvoyer une invitation | le renvoi **tourne** l'empreinte sur la même ligne : un renvoi n'ajoute pas de ligne, et l'ancien lien meurt |
| révoquer deux fois | `update … where … revoked_at is null` : la seconde ne trouve rien et le refus est le même |
| la migration | `pnpm db:migrate` rejoué deux fois, second passage « Rien à appliquer » |

Deux points vérifiés plutôt que supposés :

- **l'index partiel existe dans le paquet installé** : `drizzle-orm@0.45.2`,
  `pg-core/indexes.d.ts`, `IndexBuilder.where(condition: SQL)` et
  `IndexConfig.where?: SQL` (« Condition for partial index »). Le SQL produit par
  `pnpm db:generate` sera relu ;
- **le prédicat de l'index ne peut pas porter `now()`** — un prédicat d'index
  PostgreSQL doit être immuable. L'unicité couvre donc « ni acceptée ni
  révoquée », **expirées comprises**. Conséquence assumée, et c'est la bonne : une
  invitation expirée se **renvoie** (le renvoi repousse l'échéance et tourne le
  jeton) plutôt que de se dupliquer. Le prédicat du renvoi n'exige donc pas la
  non-expiration ; celui de l'acceptation, si.

L'adresse est **normalisée dans le `domain`** (bords rognés, casse abaissée)
avant d'atteindre la base : sans cela, `Marie@Example.test` et
`marie@example.test` seraient deux invitations que l'index ne distinguerait pas
de deux adresses différentes, et le refus « déjà membre » se contournerait par
une majuscule.

---

## 9. Les écrans, et ce que le dépôt exige d'un écran neuf

### 9.1 Où l'interface atterrit

- **`/organizations`** (écran existant, module) reçoit trois blocs : les
  **membres**, les **invitations en attente**, et le **formulaire d'invitation**.
  Ils ne s'affichent que lorsqu'une organisation est courante — comme la carte
  « Paramètres » aujourd'hui.
- **`/invitations/accept`** (écran neuf, application) : la page d'atterrissage du
  lien. Elle rend un `<form method="post">` ; **elle n'accepte rien en `GET`**.
  C'est le point qui compte : un aperçu de lien (client de messagerie,
  antivirus, proxy) suit les `GET` et consommerait le jeton à usage unique avant
  l'invité. C'est la même raison qui fait de la bascule d'organisation une
  soumission et non un lien (`packages/ui/src/composed/org-switcher.tsx` l. 24-31).

### 9.2 Ce qu'un écran neuf déclenche mécaniquement

Trois gardes, toutes vérifiées par `pnpm test`, et chacune rougit si on l'oublie :

1. `tests/organizations.test.ts` l. 597-611 dérive **du disque** les segments de
   premier niveau de `apps/web/app` et exige que chacun soit dans
   `reservedSlugs` ⇒ `invitations` entre dans `APPLICATION_SEGMENTS`
   (`apps/web/lib/organizations.ts` l. 101-114) ;
2. `tests/rendered-text.test.ts` l. 677-679 compare la liste des écrans rendus
   aux `page.tsx` trouvés sur le disque ⇒ l'écran entre dans la liste, avec son
   champ `refuses` **dérivé** de `organizations.available` (le patron de l'écran
   des organisations, l. 546-564) et ses `technicalProps` déclarés **sur cet
   écran** (constat F5 de la revue de s15 : la liste globale ne se desserre pas) ;
3. `tests/design-system.test.ts` l. 118-191 exige que tout `.tsx` suivi par git
   soit couvert par un `@source` de Tailwind — `packages/modules/*/src/presentation`
   l'est déjà, `apps/web/app` aussi ; un écran sous `apps/web/app/invitations`
   est donc couvert sans rien ajouter (à revérifier après écriture).

### 9.3 Textes

Aucune chaîne en dur : les clés vivent dans `src/domain/message-keys.ts`
(le fichier explique pourquoi — `tests/i18n.test.ts` voit une clé citée dans un
`.tsx` **non qualifiée** et la croit manquante, mesuré dix-neuf fois en s15). Les
clés à valeur variable (statut d'invitation, motif de refus) passent par des
fonctions nommées, et `organizationsMessageKeys()` les énumère pour la garde de
complétude par locale (`tests/organizations.test.ts` l. 778-789).

Les textes de l'écran d'accueil d'invitation appartiennent à l'**application**
(`apps/web/messages/*.json`) ou au module ? L'écran est servi par l'application
mais rend un composant du module (le patron de `/organizations`). Le texte suit
le composant : catalogue du module.

### 9.4 Composants

Rien à ajouter à `packages/ui` : `Card`, `Badge`, `Button`, `Input`, `Label`,
`Alert`, `EmptyState`, `PageHeader` suffisent. Les listes (membres, invitations)
sont des `<ul>` composés dans des `Card` — `docs/design-system.md` § Responsive
demande d'ailleurs que « les tableaux passent en liste de cartes » sous `md`, et
`Table` n'est pas copié dans `packages/ui` (le baril le dit : « copier pour plus
tard livrerait du code que personne n'a exercé »). **Aucun design system gap
identifié** sur cette story.

Chaque action de ligne est son propre `<form method="post">` avec un champ caché
— `method` écrit en toutes lettres, `pnpm lint` le refuse autrement, et ces
formulaires n'ont pas de composant client : la soumission native **est** le
chemin, comme les trois formulaires de s15.

---

## 10. Décisions structurantes prises ici

1. **Le jeton est émis et haché par le module**, jamais par `auth` (§4) ⇒ table
   `organization_invitation`, empreinte `sha256`, consommation par prédicat.
2. **Pas de rotation d'identifiant de session à l'acceptation** (§3), parce que
   le jeton de session ne porte aucune autorité organisationnelle et que
   l'obtenir demanderait un point d'entrée dans `auth`. C'est une décision de
   sécurité qui engage s17 et s23 ⇒ **ADR 026**, dans le format MADR, avec les
   options rejetées. C'est la leçon du constat F3 de la revue de s15 : une
   déviation consignée dans une recherche n'est pas un ADR.
3. **L'acceptation pose l'organisation courante** (§2.3).
4. **Le rôle attribué à un invité est `member`, fixe.** Choisir le rôle à
   l'invitation est une permission, donc s17 (`docs/stories.md`, s17 :
   « un admin peut inviter et retirer des members »). s16 ne pose aucune garde de
   rôle : n'importe quel membre peut inviter, et c'est s17 qui refermera. Écrit
   pour que le prochain agent ne le lise pas comme un oubli.
5. **Le quota d'émission n'est pas la limitation de débit de s28** (§7).

---

## 11. Ce qui n'a pas été vérifié

Dit plutôt que sous-entendu, et ce n'est pas la liste de ce qui existe :

- **la CI GitHub Actions** — elle n'a jamais tourné sur ce dépôt (`docs/STATE.md`) ;
- **un envoi réel** — aucune clé Resend ; tout passe par la capture locale ;
- **la concurrence réelle** sur l'acceptation simultanée du même lien : le
  prédicat la rend sûre par construction, mais deux requêtes n'ont pas été
  lancées en parallèle contre une vraie base ;
- **le comportement avec le module `i18n` coupé** — configuration non essayée,
  déjà signalée non vérifiée par la revue de s15 ;
- **un lecteur d'écran réel** et **le contraste calculé** — la vérification
  visuelle porte sur le thème, le 390 px et le débordement ;
- **le second moteur** — Chromium seul, comme tout le dépôt.
