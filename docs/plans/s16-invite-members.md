---
story: s16-invite-members
validated: yes
---

# Plan — s16-invite-members

Recherche : `docs/research/s16-invite-members.md`.
Design : `docs/designs/s16-invite-members.md` (+ `.html`).

**Sections des socles engagées** — `docs/security.md` **§2** (jeton à usage
unique : durée de vie courte, consommation atomique, invalidation ; rotation
d'identifiant de session : blocage nommé, recherche §3 et ADR 026), **§3**
(autorisation serveur, 404 et jamais 403, résolution unique du propriétaire),
**§4** (Zod à chaque frontière, redirections à destination constante), **§5**
(aucun secret en clair : le jeton n'existe en clair que dans le lien envoyé),
**§7** (aucune énumération de comptes ; quota d'émission d'invitations).
`docs/reliability.md` **§1** (consommation atomique, contrainte d'unicité plutôt
que vérification préalable, migration rejouable), **§2** (l'échec d'envoi laisse
un état explicite et renvoyable), **§4** (migration additive).

**Aucun nouveau fichier de test.** Les cas de règles pures entrent dans
`packages/modules/organizations/src/domain/organization-rules.test.ts`, les cas
de câblage dans `tests/organizations.test.ts`, le rendu dans
`tests/rendered-text.test.ts`, le parcours dans `e2e/organizations.spec.ts`.
Ouvrir un second fichier pour la même unité coûte un environnement complet et ne
prouve rien de plus.

**Ce que ce plan ne fait pas**, et ce n'est pas un oubli : aucune garde de rôle
(s17), aucun choix de rôle à l'invitation (rôle `member`, fixe), aucun port de
limitation de débit (s28 — le quota d'émission n'en est pas un, recherche §7),
aucune modification du module `auth`, de `config/features.ts`,
de `apps/web/proxy.ts`, de `config/security.ts` ni de `playwright.config.ts`.

**Correction du plan** (relevée par la revue, constat F8) : la phrase d'origine
annonçait aussi « aucune modification de `generated/` ». Elle était fausse —
`generated/schema/organizations.ts` est le baril régénéré mécaniquement par
`pnpm ks` dès qu'une table est ajoutée, et il l'a été d'une ligne. C'est le plan
qui se trompait, pas le diff.

---

## Tâches

- [x] **1. La règle pure de l'invitation** — `src/domain/invitation.ts` : forme
  et normalisation d'une adresse (bords rognés, casse abaissée), durée de vie
  (7 jours), statut dérivé d'une ligne (`pending`, `expired`, `revoked`,
  `accepted`), utilisabilité d'un jeton à un instant donné, motifs de refus
  (`invalid_email`, `already_member`, `already_invited`, `invitation_quota`,
  `email_failed`, `last_owner`, `not_a_member`), rôle attribué (`member`), règle
  du retrait (« le dernier propriétaire ne se retire pas »). Cas ajoutés à
  `src/domain/organization-rules.test.ts` : normalisation, adresse refusée,
  expiration à l'instant exact (`<=`, comme `isTokenExpired` d'`auth`), statut
  d'une ligne révoquée puis expirée (l'ordre de précédence compte), dernier
  propriétaire contre propriétaire parmi deux, membre simple.
  *Mutation* : inverser la précédence `revoked` / `expired` ; abaisser la casse
  après la comparaison au lieu d'avant.

- [x] **2. La table et sa migration** — `organization_invitation` dans
  `src/schema.ts` : `id`, `organization_id` (FK cascade), `email`, `role`,
  `token_hash`, `expires_at`, `invited_by` (FK `auth_user`, `set null`),
  `created_at`, `updated_at`, `accepted_at`, `accepted_by` (FK `auth_user`,
  `set null`), `revoked_at`. Index unique **partiel**
  `(organization_id, email) where accepted_at is null and revoked_at is null`,
  index unique sur `token_hash`, index sur `organization_id`. `pnpm db:generate`,
  relecture du SQL produit (additif uniquement), `pnpm db:migrate` **deux fois**.
  Cas dans `tests/organizations.test.ts` : le module coupé ne pose pas la table
  (le cas existant compte les tables déclarées — il passe de 3 à 4).

- [x] **3. La porte de lecture** — les lectures de la story dans
  `src/infrastructure/scoped-reads.ts`, chacune avec le propriétaire en
  **premier** paramètre. Le plan en annonçait trois ; **cinq** ont été livrées,
  et le document se corrige plutôt que le code : `liveInvitationsOf(access)`
  (nommée `pendingInvitationsOf` au plan — elle rend aussi les échues, donc le
  nom du plan mentait), `invitationsIssuedSince(access, since)` (le quota),
  `invitationByDigest(digest)` — cette dernière n'a pas d'organisation pour
  propriétaire : **le jeton est le propriétaire**, et c'est écrit dans le
  fichier —, plus `memberIdentitiesOf(access)` (nommer un membre par son
  adresse) et `emailOf(userId)` (l'adresse du compte qui accepte), qu'aucun
  écran ne pouvait rendre sans elles. `membersOf` existe déjà, elle est
  réemployée. Une sixième s'ajoute au tour de correction :
  `invitationsAddressedTo(scope, email)`, pour l'export du compte.
  *Mutation* : retirer `organizationId` du prédicat de `liveInvitationsOf`.

- [x] **4. Les écritures** — dans
  `src/infrastructure/drizzle-organization-repositories.ts` :
  `createInvitation(access, …)` (violation d'unicité traduite en
  `already_invited`, sur **la contrainte nommée**, pas sur le seul code),
  `refreshInvitation(access, invitationId, …)` (le renvoi : tourne l'empreinte et
  repousse l'échéance, `where id and organization_id and accepted_at is null and
  revoked_at is null`), `revokeInvitation(access, invitationId)`,
  `consumeInvitation(digest, userId, now)` (**un seul ordre** : `update … where
  token_hash and accepted_at is null and revoked_at is null and expires_at > now
  returning …`), `removeMember(access, userId)` (le prédicat porte la règle du
  dernier propriétaire, en `sql` dans le `where`).
  *Mutations* : retirer `accepted_at is null` de la consommation ; retirer la
  sous-requête du dernier propriétaire ; retirer `organization_id` du prédicat de
  révocation.

- [x] **5. Les cas d'usage** — `inviteMember`, `resendInvitation`,
  `revokeInvitation`, `acceptInvitation`, `removeMember` dans
  `organization-use-cases.ts`. L'autorisation **d'abord** pour les quatre
  premières routes d'organisation (`accessFrom`), la validation ensuite — le
  patron de `renameOrganization`. `acceptInvitation` ne prend **que** le jeton et
  la session : elle n'a pas d'organisation à autoriser, c'est le jeton qui
  autorise ; elle relit ensuite l'appartenance écrite pour poser l'organisation
  courante. La vue de l'écran (`viewOrganizations`) gagne `members` et
  `invitations`, remplies **seulement** quand une organisation est courante.

- [x] **6. Le jeton et l'email** — `src/infrastructure/invitation-tokens.ts`
  (`randomBytes(32).toString('base64url')`, empreinte `sha256` base64url),
  `src/emails/invitation.ts` (template `invitation`, `fr` et `en`, données `url`
  et `organization`), `emails: [invitationEmail]` au contrat.
  `ConfigureOrganizationsOptions` reçoit `mailer` (port `@repo/ports`),
  `appUrl`, `emailLocale`, `now` et — livrée sous le nom `tokens`, une fabrique
  `InvitationTokenFactory` plutôt que l'option `generateToken` annoncée, pour
  que `generate` et `digest` restent ensemble — la fabrique de jetons ; les
  trois derniers injectés pour que la suite soit déterministe. `@repo/ports` ajouté au `package.json` du
  module.
  *Mutation* : rendre le jeton en clair au lieu de son empreinte au stockage — le
  cas « le lien envoyé ne se retrouve pas en base » doit rougir.

- [x] **7. Les routes** — cinq `POST` `authenticated` dans
  `organization-routes.ts` : `/organizations/invite`,
  `/organizations/invitations/resend`, `/organizations/invitations/revoke`,
  `/organizations/invitations/accept`, `/organizations/members/remove`. Les
  quatre premières répondent 303 vers `/organizations` avec un code de refus ;
  l'acceptation répond 303 vers `/organizations` en cas de succès et vers
  `/invitations/accept?token=…&error=<code>` en cas de refus — destination
  **constante** du module, jamais un paramètre (`docs/security.md` §4).
  *Mutation* : passer le refus de 404 à 403 sur `invite`.

- [x] **8. L'écran des organisations** — cartes « Membres » et « Invitations »
  dans `organizations-screen.tsx`, composées avec `@repo/ui` uniquement, un
  `<form method="post">` par action, `EmptyState` sur la liste vide, boutons de
  ligne nommés par leur cible. Clés dans `domain/message-keys.ts`, catalogues
  `fr` et `en`. Pas de bouton pour le dernier propriétaire.
  *Vérification visuelle* (tâche de présentation) : clair et sombre, 1280 px et
  390 px, débordement horizontal mesuré, consigné dans le design.

- [x] **9. L'écran d'acceptation** — `src/presentation/invitation-screen.tsx`
  (module) et `apps/web/app/invitations/accept/page.tsx` (application). Zod sur
  le paramètre `token` et sur `error`. `invitations` entre dans
  `APPLICATION_SEGMENTS`, l'écran entre dans `tests/rendered-text.test.ts` avec
  son `refuses` **dérivé** de `organizations.available` et ses `technicalProps`
  déclarés sur cet écran.
  *Mutation* : faire accepter l'invitation en `GET`.

- [x] **10. Le câblage de l'application** — `apps/web/lib/organizations.ts` :
  `createAppMailer()`, `resolveAuthConfig(getEnv()).appUrl`,
  `localeRouting.defaultLocale`, et les deux lectures de l'écran d'acceptation.
  L'état « module coupé » garde la **même forme** : vue vide, invitation `null`,
  aucune connexion ouverte.
  *Mutation* : retirer le mailer du point de composition.

- [x] **11. Les preuves de bout en bout** — `tests/organizations.test.ts` :
  non-énumération (invitation à une adresse qui a un compte et à une qui n'en a
  pas ⇒ **même** réponse), 404 sur l'invitation d'une autre organisation,
  acceptation rejouée (**une** appartenance), expirée / révoquée / déjà acceptée,
  déjà membre, quota, dernier propriétaire, retrait qui fait tomber l'accès pour
  la **même** session. `e2e/organizations.spec.ts` : le parcours complet dans le
  navigateur, email capturé compris. ADR 026 (rotation de session à
  l'acceptation), `AGENTS.md` du module et d'`apps/web` mis à jour.

- [x] **12. Le harnais** — `pnpm typecheck`, `pnpm lint --max-warnings=0`,
  `pnpm test`, `E2E_PORT=3116 pnpm test:e2e`, `pnpm build`, `pnpm run audit`,
  module **activé** puis **coupé** (`pnpm ks toggle organizations`) puis remis,
  `pnpm db:migrate` rejoué, arbre vérifié propre après chaque aller-retour.

---

## Tour de correction (revue `docs/reviews/s16-invite-members.md`)

Six constats, dans l'ordre où ils ont été fermés. Chaque tâche a d'abord son cas
rouge, puis la correction, puis la mutation qui rejoue le rouge.

- [x] **C1 — F1, critique. La course qui laisse l'organisation sans
  propriétaire.** Cas d'abord : dix courses, une **seule** session, deux
  soumissions parallèles (« retirer l'autre » et « me retirer ») ; neuf courses
  sur dix laissaient l'organisation sans aucun membre. Fermée par
  `pg_advisory_xact_lock` dans la transaction du retrait
  (`infrastructure/transaction-locks.ts`) : aucune table lue, verrou tombé avec
  la transaction. La porte de lecture s'élargit d'un cran — `execute` dans ce
  seul fichier, `select` et `from` toujours refusés — et l'élargissement a ses
  trois cas de lint. ADR 026 amendé : l'argument « la porte refuse un verrou »
  était une contrainte que le module s'était donnée, et elle ne prime pas sur un
  critère d'acceptation.
  *Mutation* : retirer l'appel au verrou → **1 rouge** (9 courses sur 10).

- [x] **C2 — F3. Les deux prédicats de périmètre sans filet.** Deux cas ajoutés,
  jumeaux de celui de la révocation : renvoyer l'invitation d'une autre
  organisation (aucun email parti, jeton de l'autre organisation toujours
  vivant), retirer un membre d'une autre organisation (appartenance intacte).
  *Mutations* : `refreshInvitation` puis `removeMember` privés de
  `organization_id` → **1 rouge chacune** (0 avant).

- [x] **C3 — F4. La fenêtre glissante du quota.** Cas ajouté : quota atteint,
  horloge avancée d'une heure, la 21ᵉ invitation passe.
  *Mutation* : `invitationsIssuedSince` privée de `created_at >= since` →
  **1 rouge** (0 avant).

- [x] **C4 — F2. Le renvoi hors quota.** Le renvoi devient une **émission** :
  il éteint la ligne précédente (révoquée, empreinte remplacée par celle d'un
  jeton que personne n'a reçu, donc l'ancien lien répond toujours « inconnu »)
  et en écrit une neuve, datée de l'horloge du module. Les deux portes passent
  par la même fonction de quota. ADR 026, `AGENTS.md` et `domain/invitation.ts`
  redits en conséquence.
  *Mutation* : retirer la consultation du quota au renvoi → **1 rouge**.

- [x] **C5 — F6. L'adresse invitée qui survit à la purge.** Catégorie
  `invitation` déclarée, rétention `erase`, purge qui lit l'adresse sur le
  compte puis efface les invitations qui la portent, export qui les rend.
  L'ordre de purge du registre passe du requis au dépendant → **ADR 029**, avec
  son cas dans `tests/module-registry.test.ts` : sans lui, `organizations`
  purgé après `auth` n'a plus d'adresse à lire.
  *Mutation* : retirer l'effacement des invitations → **1 rouge**.

- [x] **C6 — F5. L'adresse illisible à 390 px.** `basis-full` sous `sm` ; la
  largeur rendue est mesurée dans le navigateur (8,98 px avant, ≥ 200 px après),
  et l'adresse courte n'est plus tronquée. Consigné dans le design.

- [x] **C7 — les mineurs.** « trois tables » devenues quatre dans `index.ts` et
  `schema.ts` ; comptes de lectures redits en nommant les prédicats réellement
  éprouvés ; dérive de plan corrigée ci-dessus (noms des lectures, `tokens`,
  `generated/`) ; l'import de `@repo/module-auth` borné par `pnpm lint` et sept
  cas de `tests/lint-rules.test.ts`, au lieu d'une phrase que rien ne tenait.
