# ADR 061 — L'export de ses données vit dans le module `auth`, son orchestration dans le socle

- Status: accepted
- Date: 2026-09-06
- Scope: story s35-data-export

## Context

`exportModules` (`packages/core/src/registry.ts`) était, à l'ouverture de s35,
**le troisième contrat que le socle déclarait et que rien n'appelait** — après
la clé `jobs` du contrat, fermée par s33, et `purgeModules`, fermée par s34. Le
balayage de `apps/` et `packages/` hors tests ne trouvait aucun appelant.

Brancher cette clé demande de décider **où vit la fonctionnalité**, et la
question n'est pas de style : la règle du dépôt est qu'un module est l'unité de
composition et qu'« aucune fonctionnalité ne s'ajoute hors d'un module »
(`AGENTS.md`). Or l'export a deux propriétés qui se contredisent :

- il **traverse tous les modules activés** : construire une archive demande le
  registre, et un module qui lirait le registre fermerait le cycle
  `@repo/core` → registre → module → `@repo/core` ;
- il est une **obligation légale**, comme la suppression de compte. Il ne peut
  pas disparaître parce qu'un module optionnel est coupé — `pnpm ks toggle`
  couperait alors un droit, et `config/profiles.ts` en coupe déjà neuf.

Une troisième force est arrivée avec la revendication du critère 7 (« une
demande déjà en cours n'en déclenche pas une seconde ») : elle exige une table,
donc un module qui la possède, et un verrou consultatif, donc `execute` sur la
connexion de ce module.

## Decision

**La demande, le lien signé et leur table vivent dans le module `auth` ;
l'assemblage de l'archive vit dans `@repo/core` et lui est injecté.**

Concrètement :

- `@repo/core` porte `exportModules` et `buildDataExportArchive` : ce sont les
  seules fonctions qui connaissent le registre, et elles ne connaissent aucun
  module par son nom ;
- `@repo/module-auth` porte la table `auth_data_export_request`, la
  revendication, la signature du lien, l'échéance, l'email et les deux routes.
  Il reçoit `collectArchive` du point de composition de l'application, comme
  `storage` reçoit `readableScopes` et `marketing` reçoit `emailOfScope` ;
- `apps/web/lib/auth.ts` joint les deux, exactement comme il joint déjà
  `purgeScope` sur `purgeModules` depuis s34.

**Conséquence assumée : `AuthDatabase` gagne `execute`.** La revendication prend
un `pg_advisory_xact_lock`, qui ne s'appelle pas autrement. Ce module n'a pas de
périmètre organisationnel à tenir — contrairement à `organizations`, où
`pnpm lint` refuse `select`, `from` et `execute` partout sauf dans un fichier —,
donc aucune porte de lecture n'est ouverte par cet élargissement.

## Considered options

- **Un dix-septième module `data-export`** — rejeté : il serait optionnel, donc
  coupable, donc l'export cesserait d'exister dans un profil qui le coupe. Le
  critère 1 (« l'export appelle la fonction de chaque module activé ») deviendrait
  une promesse conditionnelle, et `pnpm test:minimal-profile` verdirait sur une
  configuration où le droit n'existe plus. Il faudrait alors l'inscrire dans
  `requiredModules`, c'est-à-dire en faire un module du socle qui n'est pas
  désactivable — ce qui est la définition de ce que `auth` est déjà.
- **L'orchestration dans le module plutôt que dans le socle** — rejeté : le
  module devrait importer le registre, ce qui ferme le cycle que `@repo/core`
  existe pour empêcher (ADR 020). C'est le même raisonnement qui a mis le
  répartiteur de tâches dans le socle plutôt que dans le module `jobs` (ADR 059).
- **Une fonctionnalité posée dans `apps/web` sans module** — rejeté : la route
  ne serait plus servie par `dispatchModuleRequest`, donc **plus limitée en
  débit** (ADR 050 dérive la couverture du registre). Une frontière publique qui
  donne accès à toutes les données d'une personne, hors du répartiteur, est
  exactement ce que le socle de sécurité refuse.
- **Le module `organizations` pour le périmètre organisation** — rejeté : il
  faudrait deux implémentations de la même demande, et l'une disparaîtrait avec
  le module. Le contrat porte déjà `ModuleScope` sous ses deux formes
  précisément pour que le code appelant soit identique dans les deux cas ; seule
  l'**autorisation** dépend du module, et elle est injectée.

## Consequences

**Plus facile** : l'export bénéficie de tout ce que le socle a déjà — la
limitation de débit dérivée du registre, le port de tâches unique du module
(s33, s34), le mailer, le secret de l'application dont la signature du lien
dérive. Aucune variable d'environnement n'est ajoutée.

**Plus difficile** : `auth` grossit. Il porte désormais l'authentification, la
suppression de compte (s34) et l'export (s35) — trois sujets qui n'ont en commun
que « la personne ». Le jour où un quatrième arrive, la question d'un module de
socle « account » distinct se posera pour de bon ; elle ne se pose pas encore
avec trois.

**À surveiller** : `auth` ne doit toujours **pas** connaître `organizations`. La
seule chose qui traverse cette frontière est une décision à trois valeurs
(`allowed | refused | unknown`), jamais un rôle — la matrice rôle × action reste
écrite une fois, dans le module qui possède les rôles. Un futur besoin qui
ferait passer un rôle ici serait le signe qu'on rejoue la matrice.

**Ce que cette décision ne règle pas** : où vit l'archive une fois construite.
C'est l'ADR 062.
