# Recherche — s17-roles-permissions

> Contexte réel, vérifié **dans le code du dépôt et les paquets installés**, pas
> dans une documentation en ligne. Ce qui suit est ce que cette recherche a
> balayé, avec les fichiers et les lignes nommés — jamais « tout ce qui
> existe ».

Worktree `/Users/olivier/www/boilerplate/.claude/worktrees/agent-ab6fc2aed3b754631`,
branche `feature/s17-roles-permissions`, base `s17`, port de parcours `3117`.
Base de branche `2aacf3d`. Mesure de départ : `pnpm test` → **1050 passés, 2
ignorés, 32 fichiers**.

## 1. Ce que la story doit décider, et ce qui est déjà là

s15 a posé les trois rôles ; s16 a posé l'invitation et le retrait **sans
aucune garde de rôle**, délibérément et par écrit
(`packages/modules/organizations/AGENTS.md`, « Ne doit jamais contenir » →
« de garde de rôle » ; ADR 026, « s17 hérite de deux constantes »).

État vérifié aujourd'hui, fichier par fichier :

| Fait | Où | Conséquence pour s17 |
|---|---|---|
| `ORGANIZATION_ROLES = ['owner','admin','member']` | `domain/organization.ts:26` | rien à créer, rien à migrer |
| `FOUNDER_ROLE = 'owner'` — le créateur est propriétaire | `domain/organization.ts:31` | **critère 1 déjà tenu**, éprouvé par « fait du créateur le propriétaire » |
| `INVITED_ROLE = 'member'`, constante | `domain/invitation.ts:28` | le rôle d'un invité reste fixe ; s17 ne le rend pas variable (ce serait un champ de formulaire de plus, hors critères) |
| `organization_member.role text not null` | `schema.ts:66` | **aucune migration** : s17 n'ajoute ni table ni colonne |
| `MembershipRecord` porte `role` | `application/organization-access.ts:39` | l'`OrganizationAccess` produit par `authorizeOrganization` **porte déjà le rôle de l'appelant** |
| `removalRefusal(members, target)` | `domain/invitation.ts:266` | la règle du dernier propriétaire existe, et elle ne connaît que le retrait |
| huit routes, toutes `authenticated` | `presentation/organization-routes.ts:38-48` | s17 ne change pas le niveau de protection déclaré ; voir §3 |

## 2. L'appelant est déjà autorisé **et** son rôle est déjà lu, dans le même ordre

`accessFrom(userId, body)` (`application/organization-use-cases.ts:206`) valide
l'identifiant d'organisation par Zod puis appelle `authorizeOrganization`, qui
appelle `repository.findMembership` → `scoped-reads.membershipOf(userId,
organizationId)` — **un seul ordre SQL portant les deux conditions**
(`infrastructure/scoped-reads.ts:197`).

Ce que cela donne à s17, et c'est le point le plus important de cette recherche :
**la vérification de permission ne coûte aucune lecture supplémentaire**. Le rôle
de l'appelant est dans l'`OrganizationAccess` que chaque cas d'usage tient déjà
en main. Une permission s'écrit donc :

```
access = accessFrom(...)   → null → 404
allows(access.role, action) → false → 403
```

et rien entre les deux. C'est aussi ce qui garantit que le rôle est **relu à
chaque requête** : il n'est mis en cache nulle part (voir §6).

## 3. Piège n°1 — `protection: { level: 'role' }` ne sert pas à ça

Le contrat de module déclare bien un niveau `role`
(`packages/core/src/module.ts:43`), et `docs/architecture.md` l. 164 le présente
comme le mécanisme du §3 du socle de sécurité. **Il n'est pas utilisable ici**,
et c'est vérifié :

- `satisfiesProtection` répond `session.roles.includes(protection.role)`
  (`packages/core/src/protection.ts:30`) ;
- `ModuleSession.roles` est une liste **de plateforme**, pas d'organisation
  (`packages/core/src/module.ts:59`) ;
- balayage du dépôt : la **seule** production de cette liste est
  `packages/modules/auth/src/infrastructure/better-auth-service.ts:603`, qui
  écrit `roles: []` en dur. Aucun autre producteur (cinq occurrences au total,
  toutes citées : `protection.ts`, `protection.test.ts`, `module.ts`,
  `better-auth-service.ts`, `auth/domain/session.ts`).

Un rôle d'organisation dépend de **quelle** organisation : il ne peut pas tenir
dans une liste attachée à la session sans y ranger une autorité
organisationnelle — exactement ce que l'ADR 025 refuse pour
`activeOrganizationId`. La garde de s17 vit donc dans la couche `application`,
adossée à une règle pure du `domain`, et **pas** dans le niveau de protection
déclaré. Les huit routes restent `authenticated`.

Conséquence à écrire quelque part : `NavigationEntry.protection` et
`RouteProtection.level: 'role'` restent réservés au rôle **plateforme** (s37,
superadmin). Le laisser croire disponible ici est exactement le défaut que s03 a
laissé passer avec `NavigationEntry.protection` — un champ déclaré que personne
ne lit.

## 4. Piège n°2 — 403 contre 404 : les deux sont demandés, et ils ne visent pas le même appelant

Deux textes opposables, qui **ne se contredisent pas** :

- `docs/security.md` §3 et l'`AGENTS.md` du module : « une ressource appartenant
  à une autre organisation renvoie **404**, jamais 403 » ;
- `docs/stories.md`, critère 6 de s17 : « un appel direct à l'API avec un rôle
  insuffisant renvoie **403** ».

La ligne de partage est l'**appartenance**, pas le rôle :

| Appelant | Ce qu'il sait déjà | Réponse |
|---|---|---|
| non membre de l'organisation | rien — l'existence ne doit pas fuiter | **404** (inchangé) |
| membre, rôle insuffisant | l'organisation existe, il en est membre, il la voit à l'écran | **403** |

Un 403 rendu à un membre ne divulgue rien qu'il n'ait déjà. Un 403 rendu à un
non-membre divulguerait l'existence : c'est pourquoi l'ordre reste
**autorisation d'abord, permission ensuite** — `accessFrom` avant `allows`, et
jamais l'inverse. Un `allows` évalué avant l'appartenance rendrait 403 sur
l'organisation d'un autre et ferait tomber les cinq cas que la mutation M7 de la
revue de s16 fait rougir.

Forme du refus : les huit routes existantes répondent **303 vers l'écran** avec
un code de motif dans l'URL (`organization-routes.ts:94`). Le 403 est donc une
**issue nouvelle** de `OrganizationOutcome`, à côté de `not_found` — et non un
`refused` de plus, qui redirigerait en 303 et ne satisferait pas le critère 6.

## 5. Piège n°3 — le dernier propriétaire se perd aussi par **rétrogradation**

s16 a fermé la course du retrait, et la mesure est au dossier : sans verrou,
**9 courses sur 10** laissaient l'organisation sans propriétaire
(`docs/reviews/s16-invite-members.md`, N1 ; revue initiale : 23 sur 25 et
16 sur 20 depuis une seule session). Le dispositif est double
(`infrastructure/drizzle-organization-repositories.ts:392`) :

1. `pg_advisory_xact_lock(hashtext(organizationId))` pris **dans la transaction**
   (`infrastructure/transaction-locks.ts:51`) — il ne lit aucune table, ce qui
   est la raison pour laquelle la porte de lecture a pu s'élargir d'un cran ;
2. le prédicat du `delete` compte les propriétaires **dans la même instruction**
   (`or(ne(role,'owner'), gt(sql\`select count(*)…\`, 1))`).

s17 ouvre une **seconde voie vers le même état interdit** : `owner → admin` ou
`owner → member`. Sans discipline identique, deux rétrogradations concurrentes
des deux seuls propriétaires laissent zéro propriétaire. Le changement de rôle
doit donc :

- s'exécuter dans une transaction prenant **le même** verrou, sur **la même
  clé** (`organizationId`) — c'est ce qui sérialise aussi une rétrogradation
  contre un retrait, et pas seulement deux rétrogradations entre elles ;
- porter le compte des propriétaires **dans le prédicat de l'`update`**, jamais
  dans une lecture préalable ;
- laisser la règle pure ne faire que **nommer** le refus, comme
  `removalRefusal`.

Le transfert de propriété (critère 4) n'a pas ce risque **par construction** :
il promeut la cible et rétrograde l'appelant dans la même transaction, si bien
que le compte ne descend jamais sous 1.

## 6. L'ADR 026 réattaqué — l'argument tient-il quand le pouvoir **augmente** ?

L'ADR 026 conclut que l'acceptation d'une invitation ne demande pas de rotation
d'identifiant de session, et il nomme lui-même les trois faits qui le
rouvriraient : « `ModuleSession` se met à porter une autorité
organisationnelle ; une lecture met l'appartenance en cache ; ou le module
`auth` expose une rotation ».

Vérifié pour s17, fait par fait :

1. **`ModuleSession` ne portera pas le rôle d'organisation.** s17 lit le rôle
   dans `organization_member`, par `membershipOf`, à chaque requête. §3 ci-dessus
   montre d'ailleurs que la liste `roles` de la session est vide en production.
2. **Aucun cache.** Le singleton `organizationsService`
   (`infrastructure/organizations-runtime.ts`) ne retient que la connexion, le
   mailer, les identifiants réservés, l'horloge et la fabrique de jetons — aucune
   appartenance, aucun rôle. `pnpm build` rend toutes les routes en `ƒ`
   (mesuré en s16, §7.1 de sa revue) ; `/organizations` n'est pas mis en cache.
3. **`auth` n'expose toujours aucune rotation** — inchangé depuis s16, et cette
   voie a consigne de ne pas y toucher.

**Ce que s16 n'avait pas à traiter et que s17 doit traiter.** s16 mesurait la
réciproque sur une perte de droit (le retrait). s17 fait *augmenter* le pouvoir
(`member → admin`, `admin → owner`), ce qui est le cas typique de la fixation de
session : un identifiant obtenu avant l'élévation, rejoué après. L'argument
structurel de s16 — « l'adresse du destinataire est dans le prédicat de
consommation, donc une session implantée ne consomme rien » — **ne s'applique
pas ici** : c'est un tiers déjà propriétaire qui décide de l'élévation, et la
victime n'a rien à consommer.

Ce qui tient malgré tout, et c'est ce qu'il faut prouver plutôt qu'affirmer :
l'identifiant de session ne **gagne** rien, parce qu'il ne porte rien. Le pouvoir
est la ligne `organization_member`, relue à chaque requête. La propriété
opposable est donc la **réciproque, dans le sens descendant** : une
rétrogradation retire le pouvoir **immédiatement, à la même session, sans
reconnexion**. C'est ce cas qui doit être écrit — le jumeau exact de « fait
perdre l'accès immédiatement, à la même session » de s16. Si un jour il
rougissait, l'ADR 026 serait à rouvrir.

Conclusion de la recherche : **l'argument vaut encore**, pour une raison qui
n'est plus celle de s16, et il mérite d'être réécrit dans un ADR à lui plutôt
que d'être déduit de l'ADR 026.

## 7. La porte de lecture unique — ce que s17 a le droit d'écrire

`eslint.config.ts`, bloc `organizationPerimeter` (l. 406-479) : `select`, `from`
et `execute` sont refusés dans **tout** `packages/modules/organizations/src`,
sauf `infrastructure/scoped-reads.ts` (les trois) et
`infrastructure/transaction-locks.ts` (`execute` seul).

Conséquence directe : **s17 n'a besoin d'aucune lecture nouvelle.** Le patron du
retrait est réemployable tel quel — écrire d'abord (ordre conditionnel), puis
relire les membres par `listMemberIdentities` (déjà dans la porte) *uniquement
pour nommer le refus*. Une lecture préalable qui déciderait serait à la fois une
fenêtre de concurrence et un fichier de plus à faire passer par la porte.

Rappel du fichier lui-même, à ne pas oublier : « la règle de lint ne lit pas le
SQL ». Un prédicat écrit dans la porte n'est éprouvé que par mutation.

## 8. Journaliser un changement de rôle — et pourquoi ce ne sera pas le journal d'`auth`

`docs/security.md` §7 nomme explicitement « changement de rôle » parmi les
événements de sécurité à journaliser avec leur acteur.

Le module `auth` a déjà le mécanisme : `describeSecurityEvent`
(`packages/modules/auth/src/domain/security-event.ts`), le port `SecurityLog`
(`auth/src/application/ports.ts:147`), l'implémentation `consoleSecurityLog`
(`auth/src/infrastructure/console-security-log.ts`). **Il est hors d'atteinte** :
`pnpm lint` refuse `@repo/module-auth` dans le module `organizations` hors de
`schema.ts` et `scoped-reads.ts` (bloc de la l. 457, sept cas dans
`tests/lint-rules.test.ts`). Et il ne doit pas être déplacé dans `@repo/core` :
une autre voie travaille sur `auth`.

Deux mesures qui décident de la forme à écrire ici :

1. `describeSecurityEvent` filtre les **valeurs** de `details` par
   `SECRET_VALUE_PATTERN = /[A-Za-z0-9_\-+/=.]{16,}/`. Un identifiant de compte
   du dépôt (`usr_` + UUID, 40 caractères) tomberait dedans : recopier ce
   filtrage journaliserait `[filtré]` à la place de la cible d'un changement de
   rôle, c'est-à-dire l'information même que le §7 demande.
2. Le filtrage n'existe là-bas que parce que `details` est un
   `Record<string, string|number|boolean>` **ouvert**. Un enregistrement à
   champs **fermés** (acteur, organisation, cible, rôle avant, rôle après) n'a
   aucun emplacement où glisser un secret : la première garde d'`auth` (« la
   forme est fermée ») suffit seule, tenue par le compilateur.

Le module aura donc son propre événement, à forme fermée, et son propre port
`SecurityLog` injecté — même patron qu'`auth`, sans son filtrage, et la raison
écrite.

## 9. L'écran — ce qui existe, et ce qu'il ne doit pas devenir

`presentation/organizations-screen.tsx` : aucun composant client, huit
formulaires natifs `<form method="post">`, `method` écrit en toutes lettres
(`pnpm lint` le refuse autrement). Le seul composant client est `OrgSwitcher`,
avec son repli `<noscript>`.

`OrganizationMemberView.removable` est **calculé côté serveur** par la règle du
`domain` : l'écran lit une donnée, il ne compte pas les propriétaires. C'est le
patron exact que s17 doit étendre — l'écran ne doit porter **aucune** condition
de rôle qu'il aurait dérivée lui-même, sinon la matrice existe à deux endroits
et le second est celui qui ment.

Design system : `Select` figure à l'inventaire de `docs/design-system.md`
(l. 115) mais n'est **pas** dans `packages/ui/src/index.ts` (vérifié : `Input`,
`Textarea` seuls des champs de saisie). Le construire pour cette story
demanderait un composant client portalisé (Radix Select) plus un repli
`<noscript>`, sur un écran qui n'en a qu'un aujourd'hui, et pour un besoin que
des boutons de soumission natifs couvrent entièrement. **Aucun composant
nouveau** : le changement de rôle est un formulaire natif de plus par ligne de
membre, avec un champ caché — la forme `RowAction` déjà en place.

`tests/rendered-text.test.ts` : l'écran des organisations est déjà inscrit
(l. 589) avec ses `technicalProps` **déclarées sur l'écran** — l'acquis du
constat F5 de la revue de s15. Toute prop technique neuve s'ajoute là, jamais
dans la liste globale.

## 10. Là où les tests vivent, et ce que la CI joue

- règles pures → `packages/modules/organizations/src/domain/organization-rules.test.ts`
  (existe, 275 lignes). La matrice rôle × action y vit **une fois** ;
- câblage, vraie base, vrai répartiteur → `tests/organizations.test.ts`
  (existe, 1770 lignes). Un **témoin de refus** par porte, jamais la matrice
  rejouée (`tdd-skill` : « les acteurs qu'une règle distingue sont énumérés une
  fois, à la règle ») ;
- parcours → `e2e/organizations.spec.ts` (existe, 443 lignes), attentes dérivées
  de `organizations.available` ;
- lint → `tests/lint-rules.test.ts` si une règle bouge.

**Aucun fichier de test nouveau n'est nécessaire**, et c'est un choix : le coût
de la suite est dominé par le coût **par fichier** (1050 cas en 9,67 s au total).

`tests/organizations.test.ts` construit **son propre** registre
(`buildRegistry({available:[authModule, organizationsModule], enabled:[…]})`,
l. 80) : il est donc vert dans les deux configurations de modules, ce qui est
littéralement le critère 7 (« le même scénario de test de permission passe
module activé et module non activé, sans variante »). La CI joue désormais les
deux configurations.

## 11. Critère 7, « module non activé » — ce qu'il demande vraiment

« La vérification accorde l'accès au propriétaire des données. » Module coupé,
`dataOwnerOf` rend `{kind:'user', userId}` (`apps/web/lib/organizations.ts`,
`ABSENT_ORGANIZATIONS`) : le compte **est** le propriétaire, il n'y a pas de rôle
à consulter.

La forme qui rend cela exécutable sans inventer de surface : la fonction de
permission prend `OrganizationRole | null`, et **`null` signifie « aucune
organisation — le compte est propriétaire de sa donnée »**, donc tout est
permis. Le même appel sert alors les deux configurations, et
`EMPTY_ORGANIZATIONS_VIEW` — la vue que l'application sert module coupé — porte
exactement ces permissions-là. Aucun `if (module activé)` de plus.

## 12. Ce que cette recherche n'a **pas** vérifié

Dit plutôt que sous-entendu, et ce n'est pas la liste de ce qui existe :

- **la CI GitHub Actions** — elle n'a jamais tourné (`docs/STATE.md`) ;
- **plusieurs instances** — le verrou consultatif est porté par PostgreSQL donc
  partagé par construction, mais rien n'a été mesuré à deux processus ;
- **un niveau d'isolation** autre que le `read committed` du conteneur local ;
- **le module `organizations` avec `i18n` coupé** — configuration jamais
  essayée, déjà signalée non vérifiée par les revues de s15 et s16 ;
- **un lecteur d'écran réel, le contraste calculé, un second moteur** que
  Chromium ;
- **le comportement du plugin `organization` de Better Auth** : il n'est pas
  monté (ADR 025), donc son contrôle d'accès (`ac`, `defaultStatements`)
  n'entre pas dans le périmètre. Les notes agentiques de la story le citent
  comme référence, pas comme dépendance.
