# Research — Story s63-application-sous-app

> Vérifiée contre la branche par défaut au commit `14627fc` (s62c mergée), en lecture seule, dans `.worktrees/s63-application-sous-app`. Aucune base, aucun serveur.

## The five structuring facts
1. **Prémisse fausse — la table de s62 ne redirigerait pas deux des trois écrans.** `legacyScreenTarget` (`apps/web/lib/legacy-paths.ts:49-60`) ne rend la cible que si **une entrée de navigation du registre** a ce `href`. Or `/app/notifications` n'en aura aucune (s62c a retiré l'entrée sidebar ; seule reste `notifications-settings` → `/app/settings/notifications`, `notification-routes.ts:293`) et `/app/onboarding` n'en a jamais eu (commentaire `apps/web/lib/organizations.ts:277-280`). Ajouter `/notifications` et `/onboarding` à la table ne produirait **aucun 308** : il faut un autre signal « écran servi dans cette configuration » (au plan, avec ADR — la table est l'ADR 075).
2. **Trois écrans seulement restent hors `/app`** dans `(app)` : `apps/web/app/(app)/{notifications,onboarding,premium}/page.tsx`. La dérivation « écran déclaré `authenticated|role|entitlement`, hors `console`, hors `/api` » ne rend aujourd'hui que `DEMO_PREMIUM_SCREEN_PATH = '/premium'` (`demo-item-routes.ts:37, :203`) — les autres entrées protégées sont sous `/app/settings`, `/console` ou `/api/modules/…` (`:171, :178`).
3. **Trois constantes de module portent les chemins** : `NOTIFICATIONS_SCREEN_PATH` (`notifications/src/domain/notification.ts:15`), `ONBOARDING_SCREEN_PATH` (`onboarding/src/domain/onboarding.ts:25`), `DEMO_PREMIUM_SCREEN_PATH` (`demo-enabled/src/presentation/demo-item-routes.ts:37`). Les consommateurs passent tous par elles (pages, `app-shell.tsx:183`, `app/(app)/app/page.tsx:41`, `lib/onboarding.ts:223`, 303 de `notification-routes.ts:97` et `onboarding-routes.ts:87`, redirections vers sign-in avec `next`) — **sauf** des littéraux `'/premium'` en e2e (`golden-path.spec.ts:175,185`, `billing.spec.ts:227,245,264,266`) et `/notifications?page=` dans `tests/notifications.test.ts:1182,1238`.
4. **Aucun lien d'email ne vise ces écrans** : `packages/emails/src/notifications.ts` ne porte ni `href` ni URL d'écran (grep `href|url|link` vide). Le critère 5 se réduit aux liens internes (constantes) — rien à migrer côté emails.
5. **Les routes d'API ne sont pas touchées** : les chemins `'/notifications/list'`, `'/onboarding/continue'`… (`notification-routes.ts:45-49`, `onboarding-routes.ts:40-41`) sont relatifs à `/api/modules/<id>` ; ils ne changent pas.

## Target story
`docs/stories.md` s63 (7 critères) : `/app/onboarding`, `/app/notifications`, `/app/premium` + tout écran protégé dérivé (hors console, hors API) ; console inchangée sans redirection ; 308 via la table ; test dérivé du disque qu'aucun écran applicatif ne reste à la racine ; liens internes/emails ; API inchangée ; e2e, golden-path, minimal-profile verts.

## Current state of the code
- Table des anciens chemins : `apps/web/lib/legacy-paths.ts:27-34` (4 entrées), lue par `apps/web/proxy.ts:108`. Fixture `tests/fixtures/legacy-screen-paths.json` contient déjà `/notifications`, `/onboarding`, `/premium` (servis aujourd'hui).
- `tests/legacy-paths.test.ts` : :47 servi-ou-redirigé ; :61 chaque cible servie **et** chaque ancien chemin **non** servi ; :148-200 module coupé ne redirige pas (via navigation) ; :202-293 **aucun ancien chemin en littéral** sous `ROOTS` = `apps/web`, `auth`, `organizations`, `billing` (`:204-209`).
- `tests/zones.test.ts` : chaque page sous exactement une zone ; `warmUpTargets()` (`e2e/support/warm-up.ts`) dérive les URL du disque.
- `APPLICATION_SEGMENTS` (`apps/web/lib/organizations.ts:~245-300`) réserve `notifications`, `onboarding`, `premium` en les justifiant par « le fichier d'écran existe sur le disque » ; `tests/organizations.test.ts` dérive les segments de premier niveau du disque.
- `e2e/support/locale.ts:10-11, :74` importe les constantes ; `onboardingCourseMounted()` :131.

## Anchor points
- Déplacer les trois dossiers sous `apps/web/app/(app)/app/` ; changer les trois constantes.
- `legacy-paths.ts` : trois lignes + un nouveau signal « servi » (fait 1).
- `tests/legacy-paths.test.ts:204-209` : étendre `ROOTS` aux modules `notifications`, `onboarding`, `demo-enabled`.
- Nouveau test (critère 4) dans `tests/zones.test.ts` : pages de `(app)` toutes sous `app/`.

## Verified APIs / functions
- `legacyScreenTarget(internalPath, registry: Pick<ModuleRegistry,'navigation'>)` — `legacy-paths.ts:49`.
- `warmUpTargets()` — `e2e/support/warm-up.ts`, utilisé par `tests/legacy-paths.test.ts:48` et `tests/zones.test.ts`.
- `visibleNavigation`, `navigationSurfaceOf` (défaut `'app'`) — `packages/core/src/protection.ts:111`.

## Traps & constraints
- **Garde « module coupé »** (fait 1) : `/app/notifications` et `/app/onboarding` doivent rediriger quand leur module est activé, et **pas** quand il est coupé (`tests/legacy-paths.test.ts:148-200` ; `test:minimal-profile` coupe `notifications`, et selon le profil `onboarding`). `/app/premium` : le module `demo-enabled` porte l'entrée — garde actuelle suffisante.
- **Onboarding sans entrée de navigation** : le signal peut être l'identifiant du module dans `registry.modules`, ou une clé de contrat ; ne pas ajouter d'entrée de navigation (elle apparaîtrait dans la barre latérale, contraire à s62c/s40).
- `/app/premium` : ce segment sous `/app` ne heurte aucune rubrique existante ; `/app/notifications` ne heurte pas `/app/settings/notifications`.
- `APPLICATION_SEGMENTS` : les trois segments restent réservés (anciens chemins redirigés, comme `account`/`billing` en s62a) — commentaires à réécrire ; `tests/organizations.test.ts` dérive du disque, les trois segments n'y seront plus → vérifier que le test n'exige pas l'égalité stricte.
- Golden-path dérive l'atterrissage onboarding (`golden-path.spec.ts:164, :278, :324, :337` via constante) : garder dérivé ; seuls `:175, :185` sont des littéraux.
- Zones : `(app)/app/onboarding` hérite du layout `(app)/app/` — vérifier que le parcours d'intégration n'avait pas un gabarit propre (le déplacer peut ajouter la sous-navigation settings ? non : settings a son layout dans `app/settings/`).
- Cinq routes Next hors répartiteur (`find apps/web/app/api -name route.ts`) : intactes.
- Console : aucun fichier sous `(console)` ne bouge ; aucune entrée console dans la table.

## Open questions
1. Signal « servi » pour la table : identifiant de module propriétaire par ligne (`registry.modules`) vs. écran déclaré par le module (nouvelle clé optionnelle de contrat, ADR 069-like) vs. test du disque — à trancher au plan, ADR (amende l'usage de l'ADR 075).
2. Le critère 1 « chaque écran qu'un module déclare » : un test doit-il dériver cette liste du registre (entrées protégées hors console/API → toutes sous `/app`) pour tenir la règle dans le temps ? Recommandé.

## Real complexity
Cotée **3**, confirmée **3** : trois déplacements de dossiers et de constantes, un signal de garde à changer dans la table (le seul vrai risque), des tests de dérivation. Pas de migration, pas de nouvel écran (pas de `/ks-design` : aucune UI change).
