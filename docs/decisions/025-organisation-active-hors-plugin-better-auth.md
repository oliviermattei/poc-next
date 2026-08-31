# ADR 025 — L'organisation active est une table du module, pas une colonne de session

- Status: accepted
- Date: 2026-08-31
- Scope: story s15-organizations
- Supersedes: ADR 004, pour le seul emploi du plugin `organization` de Better Auth

## Context

L'ADR 004 (accepté, cadrage) tranche « Better Auth, avec ses plugins
`organization`, `admin`, `two-factor` et `@better-auth/passkey` ». s15 est la
première story qui utilise réellement le premier de ces plugins, et la mesure
faite à l'implémentation contredit l'hypothèse sur laquelle l'ADR 004 reposait.

Mesure, dans le paquet installé — `better-auth@1.7.2`,
`node_modules/better-auth/dist/plugins/organization/organization.mjs`, lignes
856-871 : le plugin déclare `schema.session.fields.activeOrganizationId`. Il
ajoute donc une **colonne à la table `session`**, c'est-à-dire à `auth_session`,
qui appartient au module `auth` — un module du socle non désactivable
(ADR 021).

Trois conséquences se cumulent, et chacune casse un engagement déjà pris :

1. **La colonne survit à la coupure du module.** Le critère de s15 — « aucune
   des tables du module sur une base vierge quand il est coupé » — tombe : la
   trace de l'organisation resterait dans `auth_session`.
2. **Une table appartiendrait à deux modules.** `packages/db/src/references.ts`
   refuse déjà cette situation, et l'ADR 018 fait de l'appartenance d'une table
   à un module la condition de ses clés étrangères.
3. **L'organisation active vivrait dans la session.** Le critère 2 de la story
   exige qu'elle persiste **entre deux sessions** ; une colonne de session la
   perd à chaque reconnexion.

L'ADR 004 est immuable, et sa décision sur Better Auth comme socle
d'authentification n'est pas remise en cause. C'est l'emploi d'un de ses
plugins qui change, et un changement de décision s'écrit dans un ADR
superséquent.

## Decision

Le plugin `organization` de Better Auth n'est pas employé.

L'appartenance et l'organisation active sont portées par les **tables du module
`organizations`** : `organization`, `organization_member` et
`organization_active_selection`, cette dernière ayant le **compte** pour clé
primaire.

Le jeton de session ne porte donc **aucune autorité organisationnelle**, et le
propriétaire d'une donnée est résolu à chaque requête par `resolveDataOwner`
(`@repo/core`), depuis une lecture qui **joint l'appartenance**.

L'ADR 004 reste en vigueur pour tout le reste : Better Auth comme socle, et ses
plugins `admin`, `two-factor` et `@better-auth/passkey`, que les stories s13,
s14 et s17 emploieront — ils ne sont pas jugés ici.

## Considered options

- **Le plugin `organization` de Better Auth**, tel que l'ADR 004 le prévoyait —
  rejeté : il pose `activeOrganizationId` sur `auth_session`. La colonne
  survivrait à la coupure du module, ferait appartenir une table à deux modules,
  et perdrait l'organisation active à chaque reconnexion. Les trois points sont
  mesurés ci-dessus, pas déduits.
- **Le plugin, avec sa colonne renommée ou déplacée par configuration** —
  rejeté : le plugin lit ce champ dans ses propres `hooks` de session ; le
  déplacer revient à réimplémenter le plugin tout en portant sa dépendance, et
  chaque montée de version de Better Auth redeviendrait un risque sur la table
  la plus sensible du socle.
- **L'organisation active dans un cookie signé** — rejeté : le client
  deviendrait propriétaire d'une décision d'autorisation, et la valeur ne
  persisterait pas entre deux appareils. Le socle de sécurité (§3) veut
  l'autorisation résolue côté serveur.
- **L'organisation active dans l'URL** (`/:org/…`) — rejeté : il faudrait
  réserver un segment de tête par organisation, ce qui entre en collision avec
  le préfixe de locale et avec les écrans de l'application ; et le critère 2
  demande une persistance, pas un paramètre de navigation.
- **Écrire notre propre plugin Better Auth** — rejeté : le PRD veut du code
  compris, et un plugin n'apporte ici qu'un couplage de plus à une bibliothèque
  jeune pour trois tables que le module possède déjà.

## Consequences

**Plus facile.** Le module reste réellement optionnel : coupé, aucune de ses
trois tables n'existe sur une base vierge, et `auth_session` est intacte. Les
clés étrangères vers `auth_user` restent permises par ADR 018, `auth` étant un
requis déclaré. La rotation de l'identifiant de session à la bascule
d'organisation est **sans objet** : le jeu de droits attaché à une session est
identique avant et après, puisque l'appartenance est relue à chaque requête.

**Plus difficile.** Les stories d'invitation (s16), de rôles (s17) et de
facturation par siège (s23) ne recevront rien du plugin : elles écrivent leurs
règles sur les tables du module. C'est le coût assumé de la modularité.

**À surveiller — la conséquence de la sélection par compte.** L'organisation
active a le **compte** pour clé primaire, pas la session : il n'y a qu'une
organisation active par compte, dernière bascule gagnante. Deux onglets ouverts
sur deux organisations différentes du **même** compte convergent donc à la
requête suivante — aucune fuite entre locataires, les deux organisations sont
les siennes. Mais une écriture future qui dérivera son propriétaire de
`dataOwnerOf` peut **atterrir dans l'organisation basculée dans l'autre
onglet**, alors que l'écran affichait la première. Une story qui écrit de la
donnée d'organisation depuis un écran doit donc confirmer le périmètre qu'elle
a affiché, et non se contenter du périmètre courant au moment de la
soumission. C'est le prix de la persistance « entre deux sessions » exigée par
le critère 2 de s15.

**À surveiller — la lecture, pas la ligne.** La ligne de sélection survit au
retrait d'un membre, et rien ne la nettoie : c'est la **lecture** qui joint
l'appartenance. Une lecture neuve qui oublierait la jointure rendrait le
périmètre d'une organisation quittée. Le module borne le risque par une porte
de lecture unique (`infrastructure/scoped-reads.ts`), tenue par `pnpm lint` ;
un futur module qui porterait de la donnée d'organisation devra se donner la
sienne.
