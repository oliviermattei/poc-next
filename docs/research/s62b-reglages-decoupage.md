# Research — Story s62b-reglages-decoupage

> Vérifiée contre la branche par défaut au commit `0387df4` (s62a mergée), en lecture seule. Les faits de fond sont dans la research de la story mère (`docs/research/s62-zone-reglages.md`, fait 4) ; celle-ci ne vérifie que ce que s62a a changé.

## The five structuring facts
1. **Les écrans sont déjà sous `/app/settings`** (s62a) : `app/(app)/app/settings/{account,organization,billing}/page.tsx`, dans le cadre `app/(app)/app/settings/layout.tsx` (titre `PageHeader` « Réglages » + `SidebarNav` de la surface `settings`, entrée courante par préfixe, `SettingsNavigation` dans `app-navigation.tsx`). s62b redécoupe le contenu, pas les chemins d'entrée de la zone.
2. **Le contenu de Compte vit dans `apps/web`** : `app/(app)/app/settings/account/page.tsx` compose, dans l'ordre, l'en-tête avec `SignOutButton`, l'avatar (`AvatarForm`, si `storage.available`), le nom et l'email (`AccountForm`), le mot de passe, les connexions (`ConnectionList`), les passkeys (`PasskeyCard`), la 2FA (`TwoFactorCard`), les cookies (`ConsentSettingsCard`, `@repo/module-consent/presentation`, si `consent.available`), les sessions (`SessionList`), l'export (`DataExportCard`) et la suppression (`DeleteAccountCard`). Chaque carte est un composant local déjà séparé : le redécoupage est une **répartition entre pages**, pas une réécriture.
3. **Le contenu d'Organisation vit dans le module** : un seul composant, `OrganizationsScreen` (`packages/modules/organizations/src/presentation/organizations-screen.tsx`), rend organisation courante + sélecteur (401-420), membres (202-270), invitations (273-350), renommage (455), suppression (501-510), création (535-543). Séparer Organisation et Membres demande **deux composants exportés** par le module (ou un paramètre de section), et les routes 303 `backToScreen` (`organization-routes.ts:136-141`) doivent revenir sur la bonne rubrique.
4. **Deux `h1` par écran** (revue de s62a, m1) : le cadre rend `PageHeader` (h1 « Réglages ») et chaque écran rend le sien. `PageHeader` (`packages/ui/src/composed/page-header.tsx`) n'a pas de niveau paramétrable : c'est toujours un `h1`.
5. **La table des anciens chemins existe** (`apps/web/lib/legacy-paths.ts`, ADR 075) : si une rubrique disparaît (ex. `/app/settings/account` éclaté en Profil et Sécurité), l'ancien chemin y gagne une ligne vers la rubrique qui reprend la page d'accueil de la zone.

## Target story
Voir `docs/stories.md`, s62b : rubriques Profil, Sécurité, Organisation, Membres, Facturation, Cookies ; contenu réparti sans perte, un test retrouve chaque carte ; RGPD atteignable depuis une rubrique listée ; anciens chemins redirigés par la table ; **un seul titre de niveau 1** ; libellés « Compte/Profil… », « Organisation », « Facturation », menu « Réglages ».

## Anchor points
- `app/(app)/app/settings/account/page.tsx` → pages `profile`, `security`, `cookies` (les composants locaux migrent avec elles).
- `OrganizationsScreen` → deux écrans exportés par `@repo/module-organizations/presentation`, deux entrées de navigation `settings` (Organisation, Membres) déclarées par le module.
- `organization-routes.ts:136-141` (`backToScreen`) : la destination 303 dépend de l'action (membres → Membres).
- `app/(app)/app/settings/layout.tsx` et le titre de rubrique.
- `apps/web/lib/legacy-paths.ts` + `tests/fixtures/legacy-screen-paths.json`.
- Messages : `apps/web/messages/{fr,en}.json` (libellés du menu et des rubriques), messages des modules pour leurs entrées.

## Traps & constraints
- **Test « sans perte »** : il doit dériver l'inventaire des cartes d'**avant** (une fixture figée, comme s62a) et les retrouver après ; un inventaire lu sur l'arbre d'après serait vide de sens.
- **Modules coupés** : Cookies disparaît avec `consent` (socle non désactivable, mais la carte est conditionnée à `consent.available`) ; Organisation et Membres avec `organizations` ; l'avatar avec `storage`.
- **La rubrique d'entrée de la zone** : le menu de compte et `ACCOUNT_SCREEN_PATH` visent `/app/settings/account` ; si ce chemin devient Profil, garder la constante (renommée ou non) cohérente avec la table.
- **`rendered-text`** enveloppe les écrans de réglages dans le layout de zone (s62a) : chaque nouvelle page s'y déclare.
- **Base partagée** avec la worktree de s67 : suites e2e complètes en fin de story seulement.

## Open questions
1. Où vont export et suppression : sous Profil (zone « danger » en bas) ou une rubrique « Données » ? La story liste six rubriques sans « Données » ; au design.
2. Le titre unique : le cadre garde le `h1` « Réglages » et la rubrique descend en `h2`, ou l'inverse ? `PageHeader` n'ayant pas de niveau, la seconde voie demande une prop — changement de composant partagé, à éviter ; au design.

## Real complexity
Cotée **3**, confirmée **3** : répartition de composants existants, un module à scinder en deux écrans, des redirections dans une table qui existe, des libellés.
