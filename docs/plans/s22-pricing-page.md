---
story: s22-pricing-page
validated: yes
---
# Plan — Story s22-pricing-page

Branch: `feature/s22-pricing-page`
Research: `docs/research/s22-pricing-page.md` — à lire d'abord ; ce plan ne le répète pas.
Design: `docs/designs/s22-pricing-page.md` (+ `.html`, référence visuelle, jamais copiée).
Décision: `docs/decisions/045-la-reprise-d-achat-apres-connexion-ne-declenche-pas-le-paiement.md`.

## Story visée

« Comparer les offres et choisir » — un visiteur consulte les tarifs et lance un
achat. Complexité relevée à **3** par la recherche.

1. Page dérivée de `config/billing.ts` : ajouter une offre la fait apparaître
   sans modifier la page.
2. Prix affichés = prix envoyés au checkout, avec un test de non-divergence.
3. `subscription` et `one_time` toutes deux présentables, périodicité adéquate.
4. Connecté → checkout ; non connecté → connexion, puis checkout.
5. Traduite dans les locales livrées quand l'i18n est activée.
6. Module `billing` coupé : la page n'existe pas, le lien disparaît.

## Tâches (ordonnées)

1. [x] **Clés de traduction du module.** Ajouter dans
   `packages/modules/billing/src/messages/{en,fr}.json` : `navigation.pricing`,
   `pricing.title`, `pricing.description`, `pricing.perMonth`, `pricing.perYear`,
   `pricing.oneTime`, `pricing.trialBadge`, `pricing.empty.*`, `pricing.noscript`,
   `pricing.checkoutFailed`, `pricing.retry`.
   *Test* : la suite i18n existante échoue si une clé n'est pas dans les deux
   locales — vérifier qu'elle rougit en retirant une clé de `fr.json`.
   *Fait autrement* : `pricing.checkoutFailed` et `pricing.retry` **non
   ajoutées**. `BillingAction` rend déjà l'`Alert` de refus depuis
   `BILLING_KEYS.refusal.*`, et le bouton est lui-même le moyen de réessayer :
   les deux clés auraient été mortes, et une clé morte est un texte que personne
   ne voit jamais. Conséquence assumée — le refus s'affiche **dans la carte**,
   sous le bouton qui l'a demandé, et non « au-dessus de la grille » comme le
   disait le design (consigné dans `docs/designs/s22-pricing-page.md`).

2. [x] **Entrée de navigation publique.** Ajouter à `billingNavigation`
   (`packages/modules/billing/src/presentation/billing-routes.ts:191`) une
   seconde entrée `{ id: 'pricing', href: '/pricing', labelKey:
   'navigation.pricing', order: 10, protection: { level: 'public' } }`.
   *Test* : `tests/module-registry.test.ts` — l'entrée est présente quand le
   module `billing` est activé, **absente** quand il est coupé, et son niveau
   est `public`. C'est le critère 6, moitié navigation.
   *Fait autrement* : le cas vit dans `tests/billing.test.ts`, pas dans
   `tests/module-registry.test.ts`. Il y réemploie les fixtures `registry` /
   `withoutBilling` et éprouve donc les **deux configurations dans la même
   exécution**, ce que le fichier prévu n'aurait pas donné — celui-ci ne voit que
   la configuration livrée.

3. [x] **Sélection de l'offre à mettre en avant — décision de présentation.**
   Le catalogue ne déclare aucune offre recommandée (le design l'a relevé). Ne
   rien inventer dans `config/billing.ts` : la carte en variante `default` est
   la **dernière offre `subscription`** du catalogue, les autres en `outline`.
   Règle pure, dans `domain/`.
   *Test* : `packages/modules/billing/src/domain/pricing.test.ts` — sur un
   catalogue sans abonnement, aucune carte n'est `default` ; sur trois offres,
   une seule l'est.

4. [x] **Libellé de périodicité.** Fonction pure rendant la clé de périodicité
   d'une offre : `month` → `pricing.perMonth`, `year` → `pricing.perYear`,
   `one_time` → `pricing.oneTime`. **Pas de division mensuelle** pour l'annuel —
   la recherche l'a laissée ouverte, ce plan la refuse : afficher « 24,17 €/mois »
   pour un prélèvement annuel de 290 € est une affirmation que rien ne valide.
   *Test* : même fichier — les trois modes, plus le refus d'une offre
   `one_time` porteuse d'un `interval` (que le catalogue interdit déjà au
   démarrage).

5. [x] **`PricingTable`, composé maison.** Dans
   `packages/modules/billing/src/presentation/pricing-table.tsx`, exposé par le
   second point d'entrée `@repo/module-billing/presentation` (ADR 024) — **le
   barrel principal ne réexporte jamais un `.tsx`**. Composé exclusivement de
   `Card`, `Badge`, `Button`, `Separator` de `packages/ui`. Prix via
   `formatOfferPrice` (`domain/offer.ts:189`). Le nombre de cartes vient de la
   longueur du catalogue.
   *Vérification* : `pnpm lint` + `pnpm typecheck` (la frontière de couches et
   la règle JSX du barrel sont tenues par le lint et le typecheck de `@repo/db`),
   plus un contrôle visuel navigateur à 375 px et 1280 px, thème clair et sombre.

6. [x] **La page `/pricing`.** `apps/web/app/pricing/page.tsx`, sur le modèle de
   `app/billing/page.tsx:50-51` : `if (!billing.available) notFound()`, **sans**
   redirection de session — la page est publique. Elle lit `billingCatalogue()`
   (`apps/web/lib/billing-catalogue.ts:33`), jamais `billing.view()` qui exige
   une session. `?offer=` validé par Zod contre le catalogue (ADR 045) ; une
   valeur inconnue est ignorée sans erreur.
   *Test* : `tests/billing.test.ts` — 404 quand le module est coupé ; 200 et
   trois cartes quand il est actif ; `?offer=<inconnu>` rend la page sans erreur
   et sans mise en évidence. C'est le critère 6, moitié page.

7. [x] **Le CTA et les deux parcours.** Réemployer `BillingAction`
   (`apps/web/app/billing-actions.tsx`) pour le visiteur connecté — il porte
   déjà l'état `pending`, le `<noscript>` et la désactivation avant hydratation.
   Pour l'anonyme, un lien vers
   `${path('/sign-in')}?next=${encodeURIComponent('/pricing?offer=<id>')}`.
   `safeRedirectPath` (`auth/src/domain/redirect.ts:17`) préserve la chaîne de
   requête et refuse déjà l'absolu et le `//`.
   *Test* : `tests/billing.test.ts` — l'anonyme reçoit un lien vers la connexion
   portant l'offre ; le connecté reçoit l'action de checkout. Plus un test de
   redirection : `?next=https://evil.test` et `?next=//evil.test` retombent sur
   le repli, **sur cette page précise**.
   *Fait autrement* : la moitié « cible forgée » de ce cas **redit** ce que
   `packages/modules/auth/src/domain/auth-rules.test.ts:128,132` énumère déjà —
   la règle est prouvée chez elle, et un second site ne l'éprouve pas mieux. Ce
   qui appartient vraiment à cet écran est la première moitié : le `next` que la
   page **produit** traverse `safeRedirectPath` sans être réécrit. L'aller-retour
   complet — connexion puis retour sur l'offre — est désormais éprouvé au
   navigateur (`e2e/billing.spec.ts`, « rend le focus au bouton de l'offre
   reposée »), ce qu'aucun test de nœud ne peut faire.

8. [x] **Le test de non-divergence (critère 2).** Pour **chaque** offre rendue,
   l'`offerId` porté par le CTA résout dans le catalogue vers une offre dont
   `amount` et `currency` sont exactement ceux affichés. Le test doit rougir si
   quelqu'un introduit une seconde source de prix.
   *Mutation à vérifier* : remplacer l'`amount` affiché par une constante — le
   test doit rougir. S'il reste vert, c'est le test qui est faux, pas le code.
   **Écrire dans le test, en toutes lettres, ce qu'il ne prouve pas** : il
   compare l'affichage au catalogue, jamais au prix réel chez le fournisseur
   (`config/billing.ts:18-21`).

9. [x] **Parcours navigateur.** Dans `e2e/billing.spec.ts` : un visiteur anonyme
   ouvre `/pricing`, voit trois offres, clique « Souscrire » et arrive sur la
   connexion avec son offre conservée. Plus le contrôle de non-débordement sous
   400 px, comme les autres écrans (critère de s08).

10. [x] **Documentation.** `packages/modules/billing/AGENTS.md` — la surface
    publique du module change (une entrée de navigation publique, un composant
    exposé). `docs/architecture.md` si la liste des pages y est tenue.

## Reprise après revue (F1, F2, F6, F7)

La revue `docs/reviews/s22-pricing-page.md` a laissé passer la story avec deux
constats majeurs, corrigés dans le même commit :

- **F1 — le focus de l'offre reposée ne fonctionnait pas** pour un visiteur
  **connecté**. L'attribut `autofocus` rendu par React est appliqué par le
  navigateur à l'analyse du document, où le bouton du déclencheur est encore
  **désactivé** (il l'est jusqu'à l'hydratation) : rien n'était focalisé, et rien
  ne reposait le focus au rallumage. Option retenue : **faire fonctionner le
  comportement** (ADR 045 reste vrai), par `apps/web/app/use-focus-when-ready.ts`,
  qui pose le focus après l'hydratation. La branche anonyme, elle, marchait
  déjà — mesuré : un `<a autofocus>` servi est focalisé nativement. Les deux sont
  désormais tenues par `pnpm test:e2e`, seul endroit où un focus existe.
- **F2 — l'exigence de test d'ADR 045** (« un test doit échouer si quelqu'un lit
  `?offer=` sans la valider ») n'était tenue par rien. La règle est descendue
  dans `domain/pricing.ts` (`selectedOfferOf`), où la mutation mord.
- **F6** — l'exemption des prix de `tests/rendered-text.test.ts` est passée du
  jeu commun à une déclaration **par écran** (`screenData`), comme
  `technicalProps` juste à côté.
- **F7** — `periodicityKeyOf` sort du barrel principal : aucun appelant hors du
  module.

## Interdits d'exécution

- **Ne pas ajouter de champ à `config/billing.ts`** (ni `featured`, ni
  `popular`, ni `description`). La mise en avant est dérivée, tâche 3. Le diff
  de ce fichier doit rester vide.
- **Ne pas toucher `checkoutBodySchema`** (`billing-routes.ts:41`). Il est
  `strict` et n'accepte qu'un `offerId` : c'est ce qui rend le critère 2
  démontrable. Un champ de plus et la garantie tombe.
- **Ne pas ouvrir le checkout automatiquement** au retour de connexion (ADR 045).
- **Ne pas réexporter un `.tsx` depuis `packages/modules/billing/src/index.ts`** —
  `pnpm typecheck` échouerait sur `@repo/db`, pas sur le module.
- **Ne pas ajouter d'origine à `config/security.ts`.** Le tunnel exige déjà
  JavaScript précisément pour l'éviter (ADR 027).
- **Ne pas traiter le parcours sans compte préalable** : c'est `s24-guest-checkout`.
- **Ne pas écrire de couleur Tailwind brute** ni créer de primitive dans le
  module : composer depuis `packages/ui`.
- **Ne pas corriger les deux *design system gaps*** relevés par le design
  (navigation publique absente du système, `display` réservé au héros). Les
  signaler, pas les combler.

## Le point sur lequel tout repose

**La page de tarifs n'a aucun effet de bord.** Elle lit un catalogue déjà validé
au démarrage et rend du HTML ; le seul écrit possible est déclenché par un clic,
jamais par une URL (ADR 045). Tout le reste du plan en découle : c'est ce qui
autorise une page publique sans limitation de débit propre, ce qui rend le
critère 2 testable sans base, et ce qui évite qu'un lien forgé crée une session
de paiement au nom d'un tiers.

Trois endroits où cela pourrait être faux :

1. **`billingCatalogue()` est mémorisé** (`billing-catalogue.ts:33`, `catalogue ??=`).
   Si la page le mutait — un tri en place pour l'affichage — elle empoisonnerait
   le catalogue de tout le processus, checkout compris. À comparer : le tableau
   rendu doit être une copie, et un test doit lire le catalogue après rendu.
2. **`?offer=` est une entrée utilisateur qui finit dans du HTML.** À comparer
   avec `docs/security.md` §4 : validée par Zod contre le catalogue, jamais
   réinjectée telle quelle.
3. **`BillingAction` est un composant client** monté sur une page publique. À
   comparer avec le comportement sans session : il ne doit pas être rendu du
   tout pour un anonyme, sinon un `fetch` vers une route `authenticated` partira
   pour un 403 — bruit inutile et signal trompeur.

## Fichiers touchés (anticipé)

| Fichier | Nature |
|---|---|
| `packages/modules/billing/src/messages/{en,fr}.json` | clés |
| `packages/modules/billing/src/presentation/billing-routes.ts` | +1 entrée de navigation |
| `packages/modules/billing/src/domain/pricing.ts` (+ `.test.ts`) | règles pures |
| `packages/modules/billing/src/presentation/pricing-table.tsx` | composant |
| `packages/modules/billing/src/presentation/index.ts` | export |
| `apps/web/app/pricing/page.tsx` | page |
| `tests/billing.test.ts` | critères 2, 4, 6 |
| `e2e/billing.spec.ts` | parcours |
| `packages/modules/billing/AGENTS.md` | surface publique |
| `docs/decisions/045-…md` | déjà écrit |

## Stratégie de test

| Niveau | Ce qu'il couvre |
|---|---|
| `domain/pricing.test.ts` | mise en avant, périodicité — règles pures, sans base ni rendu |
| `tests/billing.test.ts` | 404 module coupé, rendu du catalogue, non-divergence, les deux parcours, la redirection bornée |
| `e2e/billing.spec.ts` | le parcours anonyme complet et le non-débordement sous 400 px |
| lint + typecheck | frontières de couches, règle JSX du barrel, absence de couleur brute |
| contrôle visuel | 375 px et 1280 px, clair et sombre — **pas** de test de composant fabriqué pour la forme |

Chaque invariant est testé à la couche la plus proche et **une seule fois** : la
périodicité est prouvée dans `domain`, pas re-prouvée dans chaque appelant.

## Definition of Done

- Les six critères d'acceptation vérifiés, chacun par un test nommé ci-dessus.
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e` verts — avec
  Postgres levé, sans quoi 288 tests se sautent en silence (constat du harnais,
  s21).
- La mutation de la tâche 8 vérifiée : neutraliser l'invariant fait rougir.
- `AGENTS.md` du module à jour ; les deux *gaps* du système de design signalés,
  non comblés.
- Un seul commit, message impératif en français, portant recherche, design, plan
  et ADR 045.
