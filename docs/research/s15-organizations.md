# Recherche — s15-organizations

> Ce que le dépôt contient réellement au 31/08/2026, ce que le paquet
> `better-auth@1.7.2` **installé** fait réellement, et les pièges mesurés.
> Rien ici n'est cité de mémoire : chaque affirmation nomme le fichier ou la
> commande d'où elle vient.

## 1. Ce que la story exige

`docs/stories.md`, chapitre `s15-organizations`, sept critères. Les trois qui
décident de l'architecture :

- **404, jamais 403** sur la ressource d'une autre organisation
  (`docs/security.md` §3) ;
- **module non activé** : aucune route, aucune entrée de navigation, **aucune
  table sur une base vierge**, et toute donnée rattachée directement à
  l'utilisateur ;
- le rattachement passe par **une seule fonction de résolution du
  propriétaire**, sinon le mode mono-utilisateur duplique chaque requête
  (`docs/architecture.md`, « Data model », et `docs/security.md` §3).

## 2. Le plugin `organization` de Better Auth : mesuré, puis écarté

`docs/architecture.md` annonce Better Auth « plugins `organization`, `admin`,
`two-factor`, `passkey` », et les notes de la story le rappellent. Le paquet
installé rend ce plugin **inutilisable ici**, pour une raison structurelle et
non de goût.

Mesure, dans `node_modules/better-auth/dist/plugins/organization/organization.mjs`,
lignes 856-872 :

```js
schema: {
  ...schema,
  session: { fields: {
    activeOrganizationId: { type: "string", required: false, input: false, … },
    …
  } }
}
```

Le plugin **ajoute une colonne à la table `session`**, c'est-à-dire à
`auth_session`, qui appartient au module `auth` (`packages/modules/auth/src/schema.ts`).
Trois conséquences, chacune bloquante :

1. **Le critère « tables absentes d'une base vierge » tombe.** La migration du
   module `auth` est un fichier SQL versionné
   (`packages/modules/auth/migrations/0000_chunky_dexter_bennett.sql`), généré
   une fois. Y ajouter `active_organization_id` la rend vraie dans les deux
   configurations : c'est exactement le comportement MakerKit que la story
   nomme comme « à ne pas reproduire ».
2. **Une table appartient à un seul module.** `packages/db/src/references.ts`
   (`DuplicateModuleTableError`) refuse déjà qu'un second module déclare une
   table déjà déclarée ; le propriétaire porte la purge, l'export et la
   rétention.
3. **Brancher le plugin exige d'éditer `packages/modules/auth/src/infrastructure/better-auth-service.ts`**,
   hors périmètre de cette voie (s12 y travaille).

**Décision** : le module `organizations` possède ses propres tables et sa
propre notion d'organisation active. Better Auth reste ce qu'il est dans ce
dépôt — le service de session, derrière le port `AuthService`. C'est une
déviation par rapport à la note de la story ; elle est déclarée comme telle.

Ce que le plugin aurait apporté et qu'il faut donc écrire : les tables
(`organization`, `member`, `invitation`), les endpoints, et le rôle par défaut
(`admin | member | owner`, ligne 51 de `schema.mjs`). Les invitations sont s16 ;
elles ne sont pas de cette story.

## 3. Rotation de l'identifiant de session : **bloqueur, non contourné**

`docs/security.md` §2 : « rotation de l'identifiant de session à l'élévation de
privilège : connexion, validation du second facteur, fin d'impersonation ». La
consigne de cette voie y ajoute le changement d'organisation active.

Surface disponible aujourd'hui, `packages/modules/auth/src/application/auth-service.ts` :
`handle`, `changePassword`, `resolveSession`, `resolveSessionId`, `localeOf`,
`useCases`, `policy`. **Aucune opération de rotation.** L'obtenir demanderait
d'exposer `auth.api` (ou un `rotateSession`) depuis
`infrastructure/better-auth-service.ts` — c'est-à-dire d'éditer le module
`auth`, explicitement hors périmètre de cette voie.

Ce que la conception fait à la place, et qui n'est pas un contournement :

> **La session ne porte aucune autorité organisationnelle.** L'organisation
> active est une ligne serveur (`organization_active_selection`), et
> l'autorisation est re-dérivée de l'appartenance **à chaque requête**, dans le
> prédicat SQL de la lecture. Le jeu de droits attaché à un identifiant de
> session est donc identique avant et après une bascule : il n'y a pas
> d'élévation, donc rien qu'une rotation protégerait.

C'est éprouvable, et c'est éprouvé (`tests/organizations.test.ts`) : après une
bascule, le jeton de session est inchangé, et l'accès à une organisation dont
on n'est pas membre reste refusé **avec le même jeton**.

> **Corrigé après la revue (constat F1).** L'encadré ci-dessus était vrai des
> trois routes du module et **faux du chemin qui résout le propriétaire d'une
> donnée** : `findActiveOrganizationId` lisait `organization_active_selection`
> seule, sans jointure sur l'appartenance. Après retrait d'un membre,
> `dataOwnerOf` rendait encore l'organisation quittée. La lecture joint
> désormais `organization_member` sur le compte
> (`infrastructure/scoped-reads.ts`), et la mutation qui retire le compte du
> prédicat fait rougir « cesse de résoudre vers une organisation qu'on a
> quittée ». La prémisse de l'encadré tient donc aujourd'hui ; elle ne tenait
> pas au moment où elle a été écrite.

**À trancher par le propriétaire** : si la rotation littérale est voulue, elle
demande un point d'entrée dans `auth`. Signalé, non pris — et l'arbitrage rendu
en revue est de ne pas la livrer : il n'y a rien à faire tourner, et une
rotation n'aurait pas corrigé F1.

## 4. Le périmètre organisationnel : la forme qui rend l'oubli détectable

Trois leviers, du plus fort au plus faible. Les deux premiers sont retenus.

### 4.1 L'appartenance est **dans le prédicat**, jamais un contrôle préalable

Le dépôt a déjà ce précédent, et il est écrit :
`packages/modules/auth/src/application/ports.ts`, `revokeForUser` — « le compte
fait partie de la condition, il n'est pas vérifié avant : l'autorisation est
dans la requête elle-même. Une vérification préalable suivie d'une suppression
laisserait la fenêtre où l'on supprime la session d'autrui ».

Appliqué ici : toute lecture ou écriture d'une organisation passe par un ordre
unique portant `organization.id = ? and organization_member.user_id = ?`.
Aucune ligne rendue ⇒ **404**. Le code appelant ne peut pas distinguer « pas
membre » de « n'existe pas », parce que la requête elle-même ne le distingue
pas.

> **Corrigé après la revue (constats F1 et F2).** « Toute lecture » était une
> intention, pas un fait : la lecture de l'organisation active n'y passait pas,
> et rien n'empêchait d'en écrire une autre. Les lectures du module sont
> maintenant réunies dans `infrastructure/scoped-reads.ts`, seul fichier où
> `select`, `from` et `execute` sont permis (`eslint.config.ts`), chacune
> prenant son propriétaire en premier paramètre.

### 4.2 Le porteur d'accès est **marqué** et ne se fabrique pas

`OrganizationAccess` est un type marqué (marque de type unique, non
exportée) : la **seule** façon d'en obtenir une valeur est
`authorizeOrganization(...)`, qui exécute la requête ci-dessus. Un repository
qui prend un `OrganizationAccess` ne peut donc pas être appelé avec un
identifiant venu du corps de la requête — `pnpm typecheck` refuse.

C'est le même mécanisme que les deux garanties déjà portées par le compilateur
dans `packages/core/src/module.ts` (`retention` indexée par `dataCategories`,
locales des emails indexées par celles des messages), et il se prouve de la
même façon : une fixture de `tests/fixtures/typing/` qui **doit** échouer, lue
par `tests/module-registry.test.ts`.

> **Portée réelle, corrigée après la revue (constat F2).** Ce levier garde les
> **écritures qui déclarent** un `OrganizationAccess` : deux des neuf méthodes
> du port (`renameOrganization`, `setActiveOrganization`). Les sept autres
> prennent des chaînes nues, et une lecture neuve n'était gardée par rien — la
> revue l'a mesuré, un fichier ajouté passait `typecheck`, `lint` et 811 tests.
> Ce qui garde les lectures est la porte unique de `scoped-reads.ts`, tenue par
> `pnpm lint`. Ne pas relire cette section comme si la marque de type couvrait
> le module entier : elle ne l'a jamais couvert.

### 4.3 La résolution unique du propriétaire

`docs/architecture.md` l'exige : « le propriétaire d'une donnée est résolu par
une fonction unique […] le code appelant est identique dans les deux cas ».
`ModuleScope` existe déjà dans `packages/core/src/module.ts`
(`{kind:'user'} | {kind:'organization'}`) et sert déjà à `purge` et `export` :
c'est la forme, elle n'est pas à inventer.

`resolveDataOwner({ session, activeOrganizationId })` vit donc dans
`@repo/core` — il **faut** qu'elle existe quand le module est coupé, et
`@repo/core` ne connaît aucun module. Elle rend `{kind:'organization'}` quand
une organisation active est résolue, `{kind:'user'}` sinon. Module coupé, le
point de composition rend toujours `null` : la fonction est la même, l'appelant
aussi.

## 5. Les slugs réservés, dérivés et non recopiés

« les slugs réservés (routes système) sont refusés ». Une liste écrite à la
main est fausse dès l'écran suivant — c'est le mode d'échec n°13 du dépôt
(`docs/STATE.md`).

Deux sources, réunies au point de composition `apps/web/lib/organizations.ts` :

- les **premiers segments des `href` de la navigation du registre**
  (`moduleRegistry.navigation`) — un module activé qui pose `/billing` réserve
  `billing` sans que personne n'y pense ;
- les **codes de locale servis** (`localeRouting.locales`) — un slug `fr`
  entrerait en collision avec le préfixe de langue posé par `apps/web/proxy.ts`.

Et une liste écrite pour les écrans que l'application sert elle-même
(`account`, `sign-in`, `api`, …) : **elle est vérifiée par une commande**.
`tests/organizations.test.ts` dérive les segments de premier niveau réellement
présents sous `apps/web/app` et exige que chacun soit refusé. Ajouter un écran
sans réserver son segment fait rougir `pnpm test`.

## 6. Ce que le dépôt impose à tout nouveau module

Relevé fichier par fichier, sur les onze contraintes rencontrées :

| Contrainte | Où c'est écrit / vérifié |
|---|---|
| 14 clés au contrat, vides s'il le faut | `packages/core/src/module.ts`, ADR 007 |
| Un module n'importe **jamais** `@repo/db` — connexion injectée | ADR 020 ; `tests/module-registry.test.ts` (« le module %s n'importe pas `@repo/db` ») |
| Clé étrangère inter-modules seulement vers un requis déclaré | ADR 018 ; `packages/db/src/references.ts`, appelée par `pnpm db:generate` |
| Second point d'entrée `presentation` pour un module à composants | ADR 024 ; sinon `pnpm typecheck` échoue **sur `@repo/db`** (TS6142) |
| `AGENTS.md` par package, trois sections, nommant chaque dépendance déclarée | `tests/agents-md.test.ts` |
| Aucun texte affiché hors catalogue | `tests/rendered-text.test.ts` (rendu en pseudo-locale) **et** `tests/i18n.test.ts` (balayage) |
| Tout écran ajouté doit être rendu par `tests/rendered-text.test.ts` | garde de couverture `pageFilesUnder(SCREEN_ROOT)` du même fichier |
| `<form>` porte `method` en littéral écrit | `pnpm lint` ; `tests/lint-rules.test.ts` |
| Aucun `@radix-ui/*` hors `packages/ui` | `pnpm lint` ; ADR 022 |
| Couches : `presentation`/`infrastructure` ne se connaissent pas | `pnpm lint` (`tooling/eslint/boundaries.ts`) |
| Migrations générées, jamais `push` ; rejouables | `packages/db/src/migrate.ts` (journal en base) |

Deux points mesurés sur le module `marketing`, le plus récent :

- son `package.json` déclare `"exports": { ".": "./src/index.ts", "./presentation": "./src/presentation/index.ts" }` ;
- son point de composition applicatif (`apps/web/lib/marketing.ts`) est **le
  seul fichier** de `apps/web` qui nomme le module, et il rend une valeur dont
  **la forme est la même dans les deux états** (`EMPTY_MARKETING_SITE`). C'est
  le patron à reprendre : aucun écran ne porte de `if (module activé)`.

## 7. Formulaires : pourquoi ceux-ci n'auront pas de JavaScript

`apps/web/app/account/account-form.tsx` est un composant **client** : il
`fetch`, gère l'erreur, et désactive son bouton jusqu'à `useHydrated()`. Ce
crochet vit dans `apps/web/app/use-hydrated.ts` ; la couche `presentation` d'un
module ne peut pas l'importer (elle ne connaît pas l'application), et le
recopier dupliquerait une affordance de sécurité.

Les formulaires de cette story sont donc des **formulaires natifs** :
`<form method="post" action="/api/modules/organizations/…">`, corps
`application/x-www-form-urlencoded`, réponse **303** vers une destination
**constante du code**. Conséquences vérifiées :

- l'affordance « bouton désactivé jusqu'à l'hydratation » devient sans objet :
  il n'y a pas d'hydratation à attendre, la soumission native **est** le
  chemin. La règle `method="post"` écrite en toutes lettres reste, et
  `pnpm lint` la vérifie ;
- **CSRF** : le cookie de session porte `SameSite=Strict`
  (`SESSION_COOKIE_ATTRIBUTES`, `better-auth-service.ts`), donc une soumission
  d'origine tierce n'emporte pas la session et se solde par un 401. C'est le
  mécanisme, il n'est pas ajouté ici — il est mesuré par `tests/auth.test.ts`
  (attributs du `Set-Cookie`) ;
- la redirection n'est **jamais** pilotée par un paramètre
  (`docs/security.md` §4) : la destination est écrite dans le module, l'origine
  vient de `request.url`.

`dispatchModuleRequest` (`packages/core/src/registry.ts`) rend la réponse du
gestionnaire telle quelle : un 303 avec `Location` traverse sans encombre.
Le proxy de locale ne voit pas `/api` (son `matcher` l'exclut), donc la
redirection vers `/organizations` est ensuite remise dans sa forme canonique
(`/fr/organizations`) par `apps/web/proxy.ts`, cas 3.

## 8. Le composant `OrgSwitcher`

`docs/design-system.md` le nomme déjà : « `OrgSwitcher` — Bascule
d'organisation (s15) », dans les composés maison. Il n'est **pas** encore
copié (`packages/ui/AGENTS.md`, tableau « Composants copiés à ce jour »). Le
livrer ici est donc conforme : le document fait foi, le baril est l'état du
jour.

Modèle direct : `packages/ui/src/composed/locale-switcher.tsx` — un
`DropdownMenu`, aucun texte en dur, tout arrive en prop déjà traduit. Une
différence assumée : les options du sélecteur de langue sont des **liens**
(`GET`, la langue vit dans l'URL) ; celles du sélecteur d'organisation sont des
**boutons de soumission** d'un `<form method="post">`, parce que basculer
change un état serveur. Un lien qui change un état serveur est une faute
d'HTTP et une porte CSRF ouverte par `GET`.

Aucun **design system gap** relevé : `DropdownMenu`, `Button`, `Card`,
`PageHeader`, `EmptyState`, `Input`, `Label`, `Alert`, `Badge`, `Separator`
existent tous dans `packages/ui/src/index.ts`.

## 9. Pièges relevés, et comment ils sont évités

1. **`pnpm ks` ne sait pas générer un module.** `pnpm ks --help` du worktree :
   `list` et `toggle`, rien d'autre — le scaffolding est s41. Le squelette est
   donc calqué sur `packages/modules/marketing`, à la main. Déviation déclarée.
2. **`pnpm db:generate` ne génère que pour les modules activés.** Le module doit
   donc être activé dans `config/features.ts` avant de générer sa migration.
   `config/features.ts` et `generated/` sont des fichiers chauds
   (`docs/STATE.md`) : cette voie les touche, il faut le savoir à la fusion.
3. **Un `.tsx` réexporté par le barril principal casse `pnpm typecheck` sur
   `@repo/db`** (ADR 024, TS6142). Deux barils, dès le squelette.
4. **Un écran ajouté sans être rendu par `tests/rendered-text.test.ts`** fait
   rougir la garde de couverture — et il doit rendre **ou refuser
   explicitement** selon l'état du module, comme les pages légales.
5. **La purge et la clé étrangère.** ADR 018 prévient : une clé étrangère
   inter-modules impose un ordre de purge inverse de l'ordre du graphe, et
   `purgeModules` parcourt le graphe dans l'ordre des requis (donc `auth` avant
   `organizations`). Ici la contrainte est déclarée `onDelete: 'cascade'` :
   effacer un `auth_user` emporte ses lignes d'appartenance, et la purge du
   module devient un no-op idempotent. C'est la réponse **pour cette
   story** ; s34/s35 devront la reprendre pour les modules qui n'auront pas ce
   luxe.
6. **`e2e/modules.spec.ts:55` rouge quand tous les modules sont activés** —
   dette connue, trou de s03 (`docs/STATE.md`). Le module `demo-disabled` reste
   coupé, donc la dette n'est pas touchée.
7. **Playwright n'a plus de `reuseExistingServer`** (commit `df3bb2f`) : cette
   voie lance ses parcours sur `E2E_PORT=3115`, base `s15`.

## 10. Sections des socles engagées

`docs/security.md` : **§2** (sessions — voir le bloqueur du §3 ci-dessus),
**§3** (autorisation serveur, 404 et non 403, résolution unique du
propriétaire), **§4** (Zod à chaque frontière, redirection à destination
constante), **§7** (aucune information exploitable dans un refus).

`docs/reliability.md` : **§1** (unicité du slug par contrainte de base, jamais
par vérification préalable ; migration rejouable), **§4** (migration additive,
rien de destructif).
