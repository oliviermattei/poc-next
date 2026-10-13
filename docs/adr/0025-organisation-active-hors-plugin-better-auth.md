# ADR 025 — L'organisation active est une table du module, pas une colonne de session

- Status: accepted
- Date: 2026-08-31

L'ADR 004 retenait Better Auth avec son plugin `organization`. Ce plugin ajoute `activeOrganizationId` à la table de session, `auth_session`, qui appartient au module socle `auth` (ADR 021) : la colonne survivrait à la coupure du module `organizations`, une table appartiendrait à deux modules (ce que `packages/db/src/references.ts` et l'ADR 018 refusent), et l'organisation active se perdrait à chaque reconnexion alors qu'elle doit persister entre deux sessions.

Le plugin `organization` n'est donc pas employé ; le reste de l'ADR 004 tient. L'appartenance et l'organisation active vivent dans les tables du module `organizations` — `organization`, `organization_member` et `organization_active_selection`, cette dernière ayant le **compte** pour clé primaire. Le jeton de session ne porte aucune autorité organisationnelle : le propriétaire d'une donnée est résolu à chaque requête par `resolveDataOwner` (`@repo/core`), depuis une lecture qui joint l'appartenance. Basculer d'organisation ne demande donc aucune rotation de l'identifiant de session : les droits attachés à la session sont identiques avant et après.

## Considered options

- **Le plugin, avec la colonne déplacée par configuration** — rejeté : le plugin lit ce champ dans ses propres crochets de session ; le déplacer revient à le réimplémenter tout en gardant sa dépendance.
- **L'organisation active dans un cookie signé** — rejeté : le client deviendrait propriétaire d'une décision d'autorisation, et la valeur ne suivrait pas d'un appareil à l'autre.
- **L'organisation active dans l'URL (`/:org/…`)** — rejeté : collision avec le préfixe de locale et les écrans, et c'est une persistance qui est demandée, pas un paramètre de navigation.

## Consequences

Une seule organisation active par compte, dernière bascule gagnante : deux onglets ouverts sur deux organisations du même compte convergent à la requête suivante. Une écriture qui dériverait son propriétaire du périmètre courant pourrait atterrir dans l'organisation basculée dans l'autre onglet ; d'où la règle de `CODING_STANDARDS.md` qui fait confirmer à un écran le périmètre qu'il a affiché.

La ligne de sélection survit au retrait d'un membre, et rien ne la nettoie : c'est la **lecture** qui joint l'appartenance. Le module borne le risque par une porte de lecture unique (`infrastructure/scoped-reads.ts`, tenue par `pnpm lint`) ; un futur module qui porterait de la donnée d'organisation devra se donner la sienne.
