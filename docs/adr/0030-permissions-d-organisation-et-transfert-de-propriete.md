# ADR 030 — Les permissions d'organisation vivent dans le domaine du module, le refus est un 403, et nommer un propriétaire est le transfert

- Status: accepted
- Date: 2026-09-01

**La matrice vit dans `packages/modules/organizations/src/domain/permissions.ts`, pas dans `RouteProtection`.** Un rôle d'organisation n'a de sens que relativement à une organisation ; le ranger dans `ModuleSession.roles`, liste globale attachée à la session, y mettrait une autorité organisationnelle, ce que l'ADR 025 refuse. Les routes du module restent `authenticated`, et `RouteProtection.level: 'role'` reste réservé aux rôles de plateforme. La garde s'applique dans la couche `application`, juste après la résolution de l'accès et avant toute validation et toute écriture, sans exception ; le rôle est celui de la lecture conjointe, relu à chaque requête. Comparer un rôle à un littéral est refusé par `pnpm lint` partout dans le module sauf dans `permissions.ts`, où une notion dérivée devient une fonction nommée (`grantsOwnership`).

Règles portées par la matrice : `owner` peut tout, `admin` administre les membres et les invitations mais ne distribue pas les rôles et ne retire qu'un `member` (`unremovableRolesFor`, appliqué dans le prédicat du `delete`, jamais par une lecture préalable) ; `member` n'administre rien. Se retirer soi-même est permis à tous — sans quoi un membre serait captif — sous la règle du dernier propriétaire. Un rôle hors matrice ne permet rien (`MATRIX[role] ?? []` : la colonne est un `text` sans contrainte). `allows(null, action)` est vrai : `null` signifie « aucune organisation », et le compte est alors propriétaire de sa donnée — le même appel sert les deux configurations de modules.

**Le refus est 403 pour un membre, 404 pour un non-membre** : la ligne de partage est l'appartenance. Un membre voit déjà son organisation, un 403 ne lui apprend rien ; un non-membre ne doit pas apprendre qu'elle existe (`docs/security.md`). D'où l'ordre : appartenance d'abord, permission ensuite. Le 403 n'a pas d'écran : le déclencheur d'une action interdite est absent de l'interface, seul un appel direct l'atteint.

**Nommer quelqu'un d'autre `owner` est le transfert de propriété** : la cible devient `owner` et l'appelant `admin`, dans la même transaction, sous le même `pg_advisory_xact_lock` que le retrait (ADR 026), avec un prédicat qui compte les propriétaires hors transfert. Un changement de rôle est journalisé comme événement de sécurité, sans rôle précédent — l'obtenir demanderait une lecture avant l'écriture.

## Considered options

- **Répondre 404 à un rôle insuffisant** — rejeté : ne protège rien face à un membre, et rend « pas membre » et « membre insuffisant » indiscernables pour le développeur.
- **Une route de transfert séparée** — rejeté : deux chemins vers l'invariant « au moins un propriétaire », dont le second est celui qu'on oublie de sérialiser.
- **Laisser un `admin` retirer un autre `admin`, ou distribuer les rôles** — rejeté : prise de pouvoir latérale entre pairs, ou fabrication de pairs qui rend sa propre destitution plus difficile. À rouvrir sur besoin réel : c'est une entrée de `MATRIX`.
- **Faire tourner l'identifiant de session à la promotion** — rejeté, mais pas pour la raison de l'ADR 026 : c'est un tiers propriétaire qui décide de l'élévation, il n'y a rien à consommer. Ce qui tient : la session ne porte aucun rôle d'organisation, aucune lecture ne met l'appartenance en cache, et la même session reçoit 403, passe après promotion, puis reçoit de nouveau 403 après rétrogradation. Mêmes conditions de réouverture que l'ADR 026.

## Consequences

Une action nouvelle s'ajoute à `ORGANIZATION_ACTION` ; le test de matrice rougit si elle n'y a pas sa ligne. L'écran ne porte aucune condition de rôle : il lit des permissions calculées par le serveur avec les mêmes fonctions que la garde.

Un `admin` rétrogradé garde les invitations qu'il a émises : elles appartiennent à l'organisation, et révoquer en cascade ferait d'une rétrogradation une opération destructive silencieuse.

Une organisation sans propriétaire est ingouvernable, et rien ne la répare. L'état est inatteignable par les routes ; la base pourrait le produire par la cascade de `organization_member.user_id` vers `auth_user`, mais la suppression de compte refuse un propriétaire unique (`sole_owner`, module `auth`), et le cas d'une tentative antérieure interrompue est suivi par #140.
