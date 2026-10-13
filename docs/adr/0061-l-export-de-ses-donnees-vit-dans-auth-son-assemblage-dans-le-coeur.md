# ADR 061 — L'export de ses données vit dans le module `auth`, son assemblage dans `@repo/core`

- Status: accepted
- Date: 2026-09-06

L'export de ses données traverse tous les modules activés, et il est une obligation légale : il ne peut pas disparaître parce qu'un module optionnel est coupé. Construire l'archive demande le registre, et un module qui lirait le registre fermerait le cycle `@repo/core` → registre → module → `@repo/core` (ADR 020).

**La demande, le lien signé et leur table vivent dans le module `auth`, du socle ; l'assemblage de l'archive vit dans `@repo/core` et lui est injecté.** `@repo/core` porte `exportModules` et `buildDataExportArchive`, les seules fonctions qui connaissent le registre, et elles ne nomment aucun module. `@repo/module-auth` porte `auth_data_export_request`, la revendication (une demande en cours n'en déclenche pas une seconde), la signature du lien, l'échéance, l'email et les routes ; il reçoit `collectArchive` du point de composition, `apps/web/lib/auth.ts`, qui joint déjà `purgeScope` sur `purgeModules`. La revendication prend un `pg_advisory_xact_lock` : `AuthDatabase` expose donc `execute`.

## Considered options

- **Un module `data-export`** — rejeté : optionnel, il serait désactivable et le droit disparaîtrait avec lui ; l'inscrire dans `requiredModules` en ferait un module du socle, ce qu'`auth` est déjà.
- **L'orchestration dans le module** — rejeté : le module devrait importer le registre. Même raisonnement que pour le répartiteur de tâches (ADR 059).
- **Une fonctionnalité dans `apps/web`, hors module** — rejeté : la route ne passerait plus par `dispatchModuleRequest`, donc plus par la limitation de débit dérivée du registre (ADR 050), pour une frontière qui donne accès à toutes les données d'une personne.
- **Le module `organizations` pour le périmètre organisation** — rejeté : deux implémentations de la même demande, dont l'une disparaîtrait avec le module. Seule l'autorisation dépend de lui, et elle est injectée.

## Consequences

- `auth` porte l'authentification, la suppression de compte et l'export : trois sujets qui n'ont en commun que « la personne ». Un quatrième poserait la question d'un module de socle distinct.
- `auth` ne connaît pas `organizations` : ce qui traverse est une décision `allowed | refused | unknown`, jamais un rôle.
- Où vit l'archive une fois construite : ADR 062.
