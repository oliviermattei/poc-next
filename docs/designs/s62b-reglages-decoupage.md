# Design — Story s62b-reglages-decoupage

> Généré par l'agent (déroulé délégué par le porteur, 28/09), à partir de `docs/design-system.md` et des composants existants. Aucun composant nouveau : les cartes actuelles sont **réparties** entre rubriques ; le cadre de la zone (s62a) ne change que par ses entrées et par le niveau des titres.

## Screen(s)

### Rubriques de la zone Réglages
Sous-navigation (surface `settings`, dérivée du registre, dans cet ordre) :

| Rubrique | Chemin | Déclarée par | Cartes (existantes, déplacées) |
|---|---|---|---|
| Profil | `/app/settings/profile` | `auth` | avatar (si `storage`), nom, email ; en bas, zone « Données » : export, puis suppression du compte (carte bordée `destructive`, inchangée) |
| Sécurité | `/app/settings/security` | `auth` | mot de passe, connexions OAuth, passkeys, 2FA, sessions actives |
| Organisation | `/app/settings/organization` | `organizations` | organisation courante (+ sélecteur), renommage, création, suppression de l'organisation |
| Membres | `/app/settings/members` | `organizations` | membres (rôles, retrait), invitations |
| Facturation | `/app/settings/billing` | `billing` | inchangée |
| Cookies | `/app/settings/cookies` | `consent` | `ConsentSettingsCard` |

- Le bouton **Se déconnecter** quitte l'en-tête de l'ancien écran Compte : la déconnexion reste dans le menu de compte de la barre du haut (déjà présente).
- `/app/settings/account` devient un ancien chemin : 308 vers `/app/settings/profile` (table d'ADR 075). `ACCOUNT_SCREEN_PATH` vise Profil.

### Titres
- Le cadre garde **le seul `h1`** : `PageHeader` « Réglages ».
- Chaque rubrique ouvre par un **`h2`** (échelle `h2` du système : 1.5rem / 600) portant son nom, plus une description courte en `text-muted-foreground` si utile. Les écrans n'utilisent plus `PageHeader`.

### Libellés
- Menu de compte (barre du haut, application et console) : « Réglages » (au lieu de « Paramètres du compte »).
- Rubriques : Profil, Sécurité, Organisation, Membres, Facturation, Cookies (fr) ; Profile, Security, Organization, Members, Billing, Cookies (en).

## Mockup
docs/designs/s62b-reglages-decoupage.html — visual reference. DO NOT copy into production: Execute builds with the real components.

## Reused components (from the design system)
- `SidebarNav` (sous-navigation, inchangée), `PageHeader` (cadre seulement), `Card*` (toutes les cartes existantes), `Separator` (au-dessus de la zone « Données » de Profil), `Badge`, `Button` — rien de nouveau.

## States
- **Modules coupés** : chaque rubrique disparaît avec son module (Organisation et Membres avec `organizations`, Facturation avec `billing`, l'avatar avec `storage` — la rubrique Profil reste, sans la carte).
- **Anonyme** : chaque rubrique redirige vers la connexion avec son propre chemin en `next`, comme aujourd'hui.
- **Retour d'une action** (303 des routes d'organisation, de sécurité) : sur la rubrique de l'action (inviter → Membres ; renommer → Organisation ; révoquer une session → Sécurité).
- **Mobile** : sous-navigation au-dessus du contenu (s62a) ; six entrées tiennent sans `Sheet`.

## Design system gaps
1. **`PageHeader` n'a pas de niveau de titre** : les rubriques composent leur `h2` en ligne (échelle `h2`). Si un second besoin apparaît, un `SectionHeader` (ou une prop de niveau) mériterait d'entrer dans `packages/ui`.
