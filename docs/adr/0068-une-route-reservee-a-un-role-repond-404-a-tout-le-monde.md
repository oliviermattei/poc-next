# ADR 068 — Une route réservée à un rôle répond 404 à tout le monde, anonyme compris

- Status: accepted
- Date: 2026-09-06

Le niveau de protection `role` désigne les surfaces qu'un produit ne veut pas annoncer (administration, modération), et `docs/security.md` interdit l'oracle d'existence : ce qu'on n'a pas le droit de voir répond 404, jamais 403. `dispatchModuleRequest` (`packages/core/src/registry.ts`) répond donc à une protection `role` non satisfaite par le même 404 qu'un chemin qui ne correspond à aucune route (`{ error: 'not_found' }`), pour tout le monde : session sans le rôle, session avec un rôle voisin, et appel anonyme. Une route réservée à un rôle est indistinguable d'une URL inventée.

L'anonyme reçoit 404 et non 401 parce qu'un 401 dit « cette route existe, connectez-vous » : il suffirait de vider son cookie pour retrouver l'oracle. Le coût est assumé — un appelant dont la session a expiré voit 404 —, parce que ces surfaces ne s'atteignent pas par hasard et que l'entrée de navigation qui y mène disparaît par la même règle (`visibleNavigation`). Le niveau `entitlement` garde son 403 (ADR 043) : le catalogue vend la fonctionnalité, son existence est publique.

Un rôle exigé doit être un rôle que le produit sait accorder : `tests/module-registry.test.ts` dérive les rôles exigés de l'annuaire des modules et le vocabulaire accordable de l'unique site d'insertion du module `admin`, et refuse un écart.

## Considered options

- **404 aux connectés, 401 à l'anonyme** — rejeté : se déconnecter suffit à retrouver l'oracle.
- **Garder 403 et cacher dans chaque module** — rejeté : la garde serait recopiée dans chaque module, et le niveau `role` resterait un champ que personne n'ose déclarer.
- **Un niveau `hidden-role` à côté de `role`, ou un statut configurable par route** — rejeté : une décision de sécurité prise route par route se prend au pire moment, et le défaut redeviendrait la vraie décision.

## Consequences

Les routes de la console restent `authenticated`, avec leur garde dans le module (ADR 058), mais plus pour la raison que l'ADR 058 donnait (« `role` rendrait 403 »). La raison en vigueur est un ordre d'évaluation que le contrat ne sait pas exprimer : `asSuperadmin` refuse une session empruntée (ADR 064) avant de juger le rôle, fail-closed. Basculer ces routes sur `role` servirait la console à une session empruntée dont le compte emprunté administre — une élévation de privilège. `packages/modules/admin/AGENTS.md` porte cette règle, et `tests/admin.test.ts` la fait rougir.

Un 404 confond désormais « aucune route », « module coupé » et « rôle absent » ; c'est voulu. Les routes du module `organizations` gardent leur 403 décidé dans le module (ADR 030) : un rôle d'organisation n'est pas un rôle de plateforme. Reste ouvert un canal temporel : une requête anonyme vers une route à rôle tente de résoudre la session, une URL inventée non ; rien ne le mesure.
