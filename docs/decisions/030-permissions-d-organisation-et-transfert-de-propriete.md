# ADR 030 — Les permissions d'organisation vivent dans le domaine du module, le refus est un 403, et nommer un propriétaire est le transfert

- Status: accepted
- Date: 2026-09-01
- Scope: story s17-roles-permissions

## Context

s15 a posé trois rôles (`owner`, `admin`, `member`) sans qu'aucun ne serve ;
s16 a livré l'invitation et le retrait **sans aucune garde de rôle**, en
l'écrivant noir sur blanc (`packages/modules/organizations/AGENTS.md`,
« Ne doit jamais contenir » → « de garde de rôle » ; ADR 026, « s17 hérite de
deux constantes »). s17 referme, et c'est la story qui décide **qui a le droit de
quoi** pour tout ce qui suit — s18 (avatar), s19 (abonnement), s24, s33, s35 s'y
appuieront.

Quatre questions se posent ensemble, et les traiter séparément produirait quatre
demi-réponses.

**1. Où vit la garde.** Le contrat de module déclare déjà un niveau de
protection `role` (`packages/core/src/module.ts`), et `docs/architecture.md`
l. 164 le présente comme le mécanisme du §3 du socle de sécurité. Mesuré avant de
décider : `satisfiesProtection` répond `session.roles.includes(protection.role)`
(`packages/core/src/protection.ts:30`), et la **seule** production de
`ModuleSession.roles` dans tout le dépôt est
`packages/modules/auth/src/infrastructure/better-auth-service.ts:603`, qui écrit
`roles: []` en dur.

Le balayage, dit pour ce qu'il est : `rg -n '\broles\b' -g '*.ts' -g '*.tsx'
packages apps config tests`, le 1er septembre 2026, rend **21 occurrences sur
11 fichiers** — c'est ce qui a été balayé, pas ce qui existe. Une seule
**produit** la valeur en exécution (`better-auth-service.ts`) ; les autres sont
la déclaration du type (`core/src/module.ts`, `auth/src/domain/session.ts`), le
contrôle (`core/src/protection.ts`), ce commentaire-ci
(`organizations/src/domain/permissions.ts`), et des tests ou fixtures
(`core/src/protection.test.ts`, `auth/src/domain/auth-rules.test.ts`,
`tests/organizations.test.ts`, `tests/module-registry.test.ts`,
`tests/fixtures/screen-viewer.ts`, `tests/app-shell.test.ts`).

La première version de cet ADR écrivait « cinq occurrences au total, toutes
citées » : faux, et le fichier manquant n'était pas anodin —
`auth/src/domain/auth-rules.test.ts` est celui qui montre `sessionOf` **capable**
de porter des rôles, donc exactement ce qu'un lecteur doit voir avant de conclure
(revue de s17, F2). La conclusion, elle, ne bouge pas.

**2. 403 contre 404.** Deux textes opposables, apparemment contradictoires :
`docs/security.md` §3 (« une ressource appartenant à une autre organisation
renvoie **404**, jamais 403 ») et le critère 6 de la story (« un appel direct à
l'API avec un rôle insuffisant renvoie **403** »).

**3. Comment la propriété se transmet.** Le critère 4 demande qu'un `owner`
puisse transférer la propriété et que l'ancien devienne `admin`.

**4. L'élévation de privilège et la rotation d'identifiant de session.**
`docs/security.md` §2 impose « rotation de l'identifiant de session à
l'élévation de privilège », et l'ADR 026 a conclu qu'elle n'avait pas d'objet
pour l'acceptation d'une invitation. s17 attaque le cas **montant** : promouvoir
quelqu'un `admin` ou `owner` **augmente** son pouvoir, ce que ni s15 (changement
de portée) ni s16 (droit ajouté par un jeton lié à une adresse) ne faisaient.

## Decision

**La matrice vit dans `packages/modules/organizations/src/domain/permissions.ts`,
pas dans `RouteProtection`.** Un rôle d'organisation dépend de *quelle*
organisation ; le ranger dans `ModuleSession.roles` y mettrait une autorité
organisationnelle, ce que l'ADR 025 refuse précisément pour
`activeOrganizationId`. Les neuf routes du module restent `authenticated`, et
`RouteProtection.level: 'role'` reste réservé au rôle **plateforme** (s37).

La garde s'applique dans la couche `application`, **juste après**
`accessFrom` et **avant** toute validation et toute écriture — aux six portes,
**sans exception**. Le rôle est celui que porte l'`OrganizationAccess` produit
par la lecture conjointe : il est donc relu à chaque requête, sans une seule
requête de plus.

La première version faisait une exception pour le changement de rôle, afin que
l'événement de refus puisse nommer sa cible. Elle est retirée (revue de s17, F5),
pour deux raisons mesurées : un `member` qui envoyait un rôle malformé recevait un
**303 vers l'écran avec un motif traduit** — ce que la section « Considered
options » de cet ADR rejette explicitement — et une sonde d'élévation qui envoie
toujours un rôle malformé n'entrait **jamais** dans le journal du §7. Le gain
revendiqué est conservé autrement : la cible et le rôle sont extraits du corps
**par Zod** pour le journal seul, et valent `null` quand ils ne valident pas.

**Un rôle hors matrice ne permet rien.** `allows` replie sur `MATRIX[role] ?? []` :
la colonne `organization_member.role` est un `text not null` sans contrainte de
valeur, et sans ce repli la fonction levait — un 500 au lieu d'un refus, sur la
fonction que s18, s19, s24, s33 et s35 appelleront avec un rôle relu en base
(revue de s17, F3).

Six actions gardées, énumérées : `organization.rename`, `member.invite`,
`invitation.resend`, `invitation.revoke`, `member.remove`, `member.set_role`.
`owner` : les six. `admin` : les cinq premières. `member` : aucune — il lit la
liste des membres, et il peut **quitter**, qui est un geste sur sa propre
appartenance et non une administration. Deux bornes de cible : un `admin` ne
retire qu'un `member`, et il ne distribue pas les rôles.

**Quitter n'est pas « retirer un membre »**, et c'est écrit ici parce que c'est
exactement l'exception qu'un lecteur du critère 2 prendra pour un bug : se retirer
soi-même est permis à tous les rôles, la règle vient en premier dans
`removalPermission` et dans `unremovableRolesFor`, et sans elle un membre serait
captif de l'organisation qui l'a invité. La règle du dernier propriétaire
continue de s'appliquer par-dessus.

**`allows(null, action)` est vrai.** `null` ne signifie pas « aucun droit » mais
« aucune organisation » : module coupé, ou compte sans organisation courante, la
donnée appartient au compte (`resolveDataOwner`, `@repo/core`), qui en est le
propriétaire. C'est le critère 7, et c'est ce qui permet au **même** appel de
servir les deux configurations sans variante.

**Le refus est 403 pour un membre, 404 pour un non-membre.** La ligne de partage
est l'**appartenance**, pas le rôle : un membre voit son organisation à l'écran,
lui répondre 403 ne lui apprend rien ; un non-membre ne doit pas apprendre
qu'elle existe. D'où l'ordre, qui n'est pas négociable : **autorisation d'abord,
permission ensuite**. Le 403 n'a pas d'écran — le déclencheur d'une action
interdite est absent de l'interface, seul un appel direct l'atteint, et lui
rendre une page traduite décrirait à l'appelant ce qu'il a raté.

**Nommer quelqu'un d'autre `owner` *est* le transfert de propriété** : la cible
devient `owner` et l'appelant `admin`, dans la même transaction. Il n'y a pas de
route de transfert distincte.

**Le changement de rôle passe par la même discipline que le retrait de s16** :
transaction, `pg_advisory_xact_lock(hashtext(organizationId))` — la **même** clé,
donc une rétrogradation est aussi sérialisée contre un retrait —, puis un ordre
conditionnel dont le prédicat compte les propriétaires. Hors transfert :
`role <> 'owner' or (select count(*) … ) > 1`. En transfert : aucun comptage, le
nombre de propriétaires ne descend jamais sous un par construction.

**L'identifiant de session ne tourne toujours pas**, et l'argument de l'ADR 026
est réexaminé plutôt que reconduit — voir « Considered options ».

**La matrice ne se compare qu'à un endroit, et c'est `pnpm lint` qui le tient.**
Comparer un rôle à un littéral est refusé partout dans le module sauf dans
`domain/permissions.ts` ; une notion dérivée du rôle y devient une fonction
nommée (`grantsOwnership`). La règle a été écrite au tour de correction parce que
la phrase existait sans commande, et qu'elle était démentie trois fois par le
commit qui l'écrivait (revue de s17, F4) — la règle en a trouvé deux de plus, dans
`domain/invitation.ts`, que la revue n'avait pas nommées. Ce qu'elle ne voit pas
est écrit dans `eslint.config.ts` : un `switch`, un `includes`, une comparaison à
une variable, et un rôle ajouté sans être ajouté au sélecteur.

**Un changement de rôle est journalisé** comme événement de sécurité
(`docs/security.md` §7), à forme fermée : son acteur, son organisation, sa cible,
le rôle **demandé** et le fait que le geste transfère ou non la propriété. Il n'y
a **pas** de rôle précédent — l'obtenir demanderait une lecture avant l'écriture,
c'est-à-dire la lecture qui décide que tout le reste de ce module refuse. La
première version de cet ADR et la tâche 7 du plan annonçaient « les deux rôles » ;
elles décrivaient un code qui n'existait pas (revue de s17, F2). `docs/security.md`
§7 n'exige que l'acteur : la conformité au socle ne dépendait pas de cette phrase.

**Au refus, la cible et le rôle valent `null` quand le corps ne les nommait pas**,
puisque la permission est décidée avant la validation. Les deux valeurs passent
par Zod avant d'entrer dans le journal : rien de brut ne sort dans la sortie
standard.

## Considered options

- **Utiliser `RouteProtection.level: 'role'`** — rejeté, et c'est le piège le
  plus probable pour l'agent suivant : le champ existe, il est documenté comme
  *le* mécanisme du §3, et il ne convient pas. Il interroge une liste attachée à
  la **session**, donc globale ; un rôle d'organisation n'a de sens que
  relativement à une organisation. L'y ranger reproduirait ce que l'ADR 025
  refuse. Le champ reste utile et reste réservé au superadmin de s37.
- **Répondre 404 à un rôle insuffisant, pour ne rien divulguer** — rejeté : le
  critère 6 demande 403, et surtout un membre ne peut rien apprendre d'un 403 sur
  une organisation dont il est membre et dont l'écran lui montre déjà
  l'identifiant. Uniformiser sur 404 rendrait un vrai « pas membre » et un
  « membre insuffisant » indiscernables **pour le développeur**, sans rien
  protéger.
- **Répondre 303 vers l'écran avec `?error=forbidden`** — rejeté : le
  déclencheur est absent pour qui n'a pas le droit, donc ce chemin n'est atteint
  que par un appel direct. Un motif traduit dans l'URL décrirait la politique à
  qui la sonde, et surtout la story exige de prouver qu'**appeler la route
  directement échoue** : un 303 vers une page de succès apparente n'est pas un
  échec lisible.
- **Une route de transfert de propriété séparée** — rejeté : deux routes pour un
  geste font deux chemins vers le même invariant (« au moins un propriétaire »),
  et le second est celui qu'on oublie de sérialiser. C'est exactement ce que s16
  a payé : le prédicat du `delete` fermait la fenêtre d'une requête isolée et
  rien d'autre.
- **Décider la borne de rôle du retrait par une lecture préalable** (lire le rôle
  de la cible, puis supprimer) — rejeté : `AGENTS.md` du module interdit une
  vérification suivie d'une opération, et pour une raison mesurable — entre la
  lecture et l'écriture, la cible peut devenir propriétaire, et un `admin`
  retirerait alors le propriétaire qu'il ne doit pas toucher. La borne est donc
  **calculée par le domaine** (`unremovableRolesFor`) et **appliquée dans le
  prédicat** ; la lecture qui suit ne sert qu'à nommer le refus. Mesuré : la
  première version du cas de test visait le dernier propriétaire, si bien que la
  règle du dernier propriétaire l'attrapait à la place de la borne de rôle et que
  la mutation restait verte. Le cas vise désormais une organisation à **deux**
  propriétaires.
- **Permettre à un `admin` de retirer un autre `admin`** — rejeté au tour de
  correction, après l'avoir livré (revue de s17, arbitrage 2). Le critère 3 dit
  « inviter et retirer des **members** » ; l'extension allait au-delà de la lettre
  et n'était discutée nulle part. Sa conséquence, elle, est concrète : deux
  administrateurs pouvaient se retirer l'un l'autre — une prise de pouvoir
  latérale que personne n'avait décidée, et que le propriétaire ne voyait pas
  venir. `unremovableRolesFor` rend donc `['owner', 'admin']` pour un `admin`, la
  borne entre dans le prédicat du `delete`, et se retirer soi-même reste permis
  parce que ce cas est évalué avant. À rouvrir si une organisation réelle demande
  qu'un administrateur fasse le ménage entre pairs : la ligne à changer est une
  seule.
- **Permettre à un `admin` de distribuer les rôles** — rejeté, et c'est
  l'arbitrage le plus discutable de cet ADR. Les critères énumèrent ce qu'un
  `admin` peut faire (« inviter et retirer des members ») et bornent ce qu'il ne
  peut pas (« ni supprimer l'organisation ni modifier un owner ») ; le rôle n'est
  pas dans la liste des permis. Le laisser distribuer les rôles lui permettrait
  de se fabriquer des pairs, donc de rendre sa propre destitution plus difficile,
  pour un gain que la story ne demande pas. **Arbitrage validé au tour de correction de s17** : plus
  strict que la lettre du critère, documenté, et distribuer le pouvoir de
  distribuer le pouvoir se décide en connaissance de cause. À rouvrir si un
  besoin réel apparaît : la ligne à changer est une seule entrée de `MATRIX`.
- **Faire tourner l'identifiant de session à la promotion** — rejeté, et
  l'argument n'est **pas** celui de l'ADR 026. Celui-là reposait sur la
  non-transférabilité du lien (« l'adresse du destinataire est dans le prédicat de
  consommation, une session implantée ne consomme rien ») : il ne s'applique pas
  ici, puisque c'est un tiers déjà propriétaire qui décide de l'élévation et que
  la victime n'a rien à consommer.

  Ce qui tient, et qui est **mesuré plutôt qu'affirmé** : l'identifiant de
  session ne gagne rien, parce qu'il ne porte rien. Les trois faits que l'ADR 026
  nomme comme conditions de réouverture ont été revérifiés pour s17 :
  `ModuleSession` ne porte aucun rôle d'organisation (il porte une liste vide, cf.
  §1 ci-dessus) ; aucune lecture ne met l'appartenance en cache — le singleton
  `organizationsService` ne retient que la connexion, le mailer, les identifiants
  réservés, l'horloge et la fabrique de jetons ; le module `auth` n'expose
  toujours aucune rotation, et cette voie a consigne de ne pas y toucher.

  La propriété opposable est la réciproque, dans les **deux** sens, et elle a son
  cas : « change le pouvoir à l'instant, sur la même session, sans reconnexion »
  (`tests/organizations.test.ts`) — la même valeur de session reçoit 403, puis
  passe après promotion, puis reçoit de nouveau 403 après rétrogradation.
  Mutation éprouvée : mettre `findMembership` en cache fait rougir ce cas **et**
  celui du transfert.

  **À rouvrir** si l'un de ces trois faits cesse d'être vrai, ou si le module
  `auth` expose une rotation — auquel cas l'appliquer ne coûte plus rien et la
  défense en profondeur vaut son prix.
- **Un composant `Select` pour choisir le rôle** — rejeté : `Select` figure à
  l'inventaire de `docs/design-system.md` mais n'est pas copié dans
  `packages/ui`. L'y copier demanderait un composant client portalisé (Radix)
  et son repli `<noscript>`, sur un écran qui n'a qu'une exception de ce genre
  (`OrgSwitcher`), pour un besoin que des boutons de soumission natifs couvrent
  entièrement. Ce n'est pas un *design system gap* : `Button` couvre le besoin.

## Consequences

**Plus facile.** Une seule fonction répond « qui a le droit de quoi », et elle
répond aussi quand le module est coupé (`null` → tout permis) : les stories
suivantes n'ont pas de branche « si les organisations existent ». L'écran ne
porte aucune condition de rôle — il lit `view.permissions` et
`members[].assignableRoles`, calculés par le serveur avec les mêmes fonctions que
la garde. Une action nouvelle s'ajoute à `ORGANIZATION_ACTIONS` et le cas de
matrice la couvre aussitôt, faute de quoi il rougit.

**Plus difficile.** Le refus `last_owner` sur le **retrait** est devenu
inatteignable par un tiers : pour retirer un propriétaire il faut en être un, et
il y en a alors deux. Il ne reste joignable que par le propriétaire unique qui se
retire ou se rétrograde lui-même. Le cas de s16 « refuse de retirer le dernier
propriétaire, y compris par lui-même » a donc changé d'assertion pour sa première
moitié : 403 au lieu de `?error=last_owner`. C'est le même invariant, refusé plus
tôt.

Un `admin` promu puis rétrogradé garde les invitations qu'il a émises : elles
appartiennent à l'organisation, pas à lui. Aucune n'est révoquée par un
changement de rôle, et c'est délibéré — révoquer en cascade ferait d'une
rétrogradation une opération destructive silencieuse.

**À surveiller — une organisation sans propriétaire est ingouvernable, et rien
ne la répare.** `member.set_role` est réservé au propriétaire : sans propriétaire,
personne ne peut en nommer un, et l'organisation est figée à vie — plus de
renommage, plus d'invitation, plus de retrait, plus de rôle. L'état est
**inatteignable par les routes** (prédicats sous le même verrou, trois
croisements de concurrence sondés à la revue).

Il est en revanche **productible par la base**, et c'est le piège de s34 :
`organization_member.user_id` référence `auth_user.id` en `onDelete: 'cascade'`
(`packages/modules/organizations/src/schema.ts:62-64`). Supprimer le compte du
dernier propriétaire efface sa ligne d'appartenance sans que rien ne compte les
propriétaires restants ; l'organisation et ses membres survivent, ingouvernables.
`docs/reliability.md` §5 exige une **commande de réconciliation** pour tout état
qui peut diverger. Elle appartient à **s34**, avec la suppression de compte, pas à
s17 — et elle est nommée ici, ainsi que dans l'`AGENTS.md` du module, pour que
l'agent de s34 la trouve avant d'écrire sa purge et non après.

**À surveiller — ce que le verrou ne tient pas.** Inchangé depuis s16 :
`hashtext` rend 32 bits, donc deux organisations peuvent partager une clé de
verrou ; la conséquence est une attente inutile, jamais une correction manquée.
La portée est **une base**, donc partagée entre processus. Rien n'a été mesuré à
deux processus, ni sous un niveau d'isolation autre que le `read committed` par
défaut.

**À surveiller — la suppression d'une organisation.** Le critère 3 la nomme comme
ce qu'un `admin` ne peut pas faire ; elle n'existe pour personne aujourd'hui, et
s17 ne la crée pas. La story qui la posera devra l'ajouter à
`ORGANIZATION_ACTIONS` — le cas de matrice rougira si elle l'oublie.
