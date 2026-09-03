# Review — Story s22-pricing-page

> Revue en contexte neuf. Chaque constat est classé : critical / major / minor.
> Diff jugé : `git diff dev...feature/s22-pricing-page` (22 fichiers, un commit `cc4159a`).
> Commandes exécutées par le relecteur, pas rapportées : `pnpm test`, `pnpm test:e2e`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, six mutations, deux sondes navigateur.

## Ce que le relecteur a mesuré lui-même

| Commande | Résultat |
|---|---|
| `docker compose up -d` + `pnpm db:migrate` | Postgres du dépôt de base joignable sur `localhost:5432/app`, migrations appliquées |
| `pnpm test` | **1671 passés, 8 sautés**, 52 fichiers verts / 2 sautés — la base était bien là (sans elle, 288 cas disparaissent en silence) |
| `pnpm typecheck` | 24 tâches vertes |
| `pnpm lint` | `ESLint: No issues found` |
| `pnpm build` | vert ; `/pricing` sort en `ƒ (Dynamic)` |
| `pnpm test:e2e` (suite complète, `E2E_PORT=3177`) | **85 passés, 8 sautés** |

## Plan compliance

- [x] Le code fait ce que le plan décrit — les dix tâches sont présentes, avec trois écarts jugés plus bas (F4) et aucune tâche manquante.
- [x] **Interdits d'exécution — chacun vérifié, nommé :**
  - `config/billing.ts` : **absent du diff**. Aucun champ `featured` / `popular` / `description` ajouté ; la mise en avant est bien dérivée (`highlightedOfferId`).
  - `checkoutBodySchema` (`packages/modules/billing/src/presentation/billing-routes.ts:41`) : **non touché**. Le diff de ce fichier ne porte que `PRICING_SCREEN_PATH` et l'entrée de navigation.
  - Checkout ouvert automatiquement au retour de connexion : **non**, et prouvé au navigateur (sonde de revue, voir « Not verified » — l'aller-retour atterrit sur `/fr/pricing?offer=pro-monthly`, jamais sur une session de paiement).
  - `.tsx` réexporté depuis `packages/modules/billing/src/index.ts` : **non**. Le barrel n'ajoute que `highlightedOfferId`, `periodicityKeyOf` (`./domain/pricing`) et `PRICING_SCREEN_PATH` (`./presentation/billing-routes`, un `.ts`). `PricingTable` sort par `packages/modules/billing/src/presentation/index.ts` — ADR 024 tenu, et `pnpm typecheck` de `@repo/db` est vert.
  - `config/security.ts` : **absent du diff**. Aucune origine ajoutée (ADR 027 tenu).
  - Parcours sans compte préalable (`s24-guest-checkout`) : non empiété — le CTA anonyme pointe `/sign-in`, pas un tunnel invité.
  - Couleur Tailwind brute ou primitive maison dans le module : **aucune**. `pricing-table.tsx` n'emploie que `border-primary`, `ring-2 ring-ring`, `text-muted-foreground`, `bg-info` via `Badge variant="info"` — tous vérifiés présents dans `packages/ui/src/styles.css` (`--ring:65,98`, `--color-primary:121`, `--color-info:134`, `--color-ring:139`). `OfferCard` est une fonction locale non exportée, pas une primitive.
  - Les deux *design system gaps* : signalés dans `docs/designs/s22-pricing-page.md`, **non comblés** — l'entrée « Tarifs » réutilise la navigation déclarative existante du registre plutôt que d'inventer un en-tête public.

## Anti-hallucination

- [x] **Aucun import ni appel inventé.** Chaque symbole du diff a été ouvert :
  `visibleNavigation` (`packages/core/src/protection.ts:55`), `satisfiesProtection` (`:28`),
  `formatOfferPrice` / `offerById` / `parseBillingCatalogue` / `BillingConfigError` (`packages/modules/billing/src/domain/offer.ts`),
  `billingCatalogue` (`apps/web/lib/billing-catalogue.ts:33`), `billing.available` (`apps/web/lib/billing.ts`),
  `safeRedirectPath` (`packages/modules/auth/src/domain/redirect.ts:17`, réexporté par `packages/modules/auth/src/index.ts:43`),
  `localeRouting.publicPath` (`packages/modules/i18n/src/application/locale-routing.ts:63`),
  `BillingIntl.t(key, values?)` (`packages/modules/billing/src/presentation/billing-intl.ts` — la signature accepte bien `{ count }`),
  et les douze exports de `@repo/ui` (`Alert`, `Badge`, `Card*`, `EmptyState`, `PageHeader`, `Separator`, `cn` — `packages/ui/src/index.ts:22,24,26,46,58,74`). `Badge variant="info"` et `Alert variant="warning"` existent bien (`badge.tsx:18`, `alert.tsx:20`).
- [ ] **Une logique plausible-mais-fausse trouvée** — le `autoFocus`, voir **F1**. Elle est plausible, commentée avec assurance, et mesurée fausse au navigateur.
- [x] Le reste du code fait ce qu'il dit : `order: 10` entre bien en collision avec `demo-enabled`, mais `packages/core/src/registry.ts:125-130` départage par `moduleId` puis `id` — l'ordre est déterministe, pas subi.

## Rules compliance

- [x] **AGENTS.md** : un commit, message impératif en français, portant recherche, design (`.md` **et** `.html`), plan et ADR 045. `AGENTS.md` du module et de `apps/web` mis à jour. Deux emplacements de test respectés (`packages/modules/billing/src/domain/pricing.test.ts` pour l'unité, `tests/` pour la traversée). Aucune dépendance ajoutée.
- [x] **ADR contredits : aucun.** ADR 024 (second point d'entrée) tenu ; ADR 027 (formulaires interactifs hors des modules — les déclencheurs arrivent en `ReactNode`, aucun `fetch` dans le module) tenu ; ADR 034 (le rattachement précède le checkout — rien n'écrit depuis cette page) tenu ; ADR 043 (niveau de protection déclaré) tenu, l'entrée porte `protection: { level: 'public' }` et c'est ce niveau qui produit la visibilité.
  **ADR 045 est respecté dans sa décision principale** — `?offer=` repose et n'achète pas — mais **deux de ses phrases ne sont pas tenues** : le focus (F1) et l'exigence de test (F2).
- [x] **Design system** : aucun composant ni token hors système. `PricingTable` rend son propre `PageHeader`, exactement comme `BillingScreen` (`billing-screen.tsx:182`) et `OrganizationsScreen` (`:377`) — précédent établi, pas une dérive. `EmptyState action={null}` a le même précédent (`billing-screen.tsx:314`, `consent-preferences.tsx:67`). Le prix est un `<p className="text-3xl font-semibold tracking-tight">`, c'est-à-dire le jeton `h1` du système (1,875 rem / 600), celui-là même que `PageHeader` pose — cohérent avec le *gap* n°2 relevé par le design, qui refusait `display` hors du héros.
- **Contrôle visuel fait par le relecteur** (dev server, quatre captures) : 375 px et 1280 px, thèmes clair et sombre, `?offer=pro-yearly`. Débordement horizontal mesuré à **0** dans les quatre cas. Trois colonnes au-delà de `md`, une seule en dessous ; la carte mise en avant porte `border-primary` **et** l'anneau de sélection, lisibles dans les deux thèmes ; le badge `info` reste contrasté en sombre ; les libellés « Souscrire » / « Acheter » suivent bien le mode de l'offre. Écran cohérent avec l'intention du design.

## Tests

- [x] Suite exécutée par le relecteur, verte, **contre une base réelle**.
- [x] Les assertions épinglent les six critères : nombre de cartes dérivé du catalogue (deux catalogues, dont un réduit, avec le témoin de refus sur les offres retirées), appariement prix ↔ offre carte par carte avec garde d'inertie (`new Set(prices).size === prices.length`), les deux parcours, la 404 module coupé, l'entrée de navigation visible/invisible, la complétude i18n. **Aucun test sans assertion, aucune assertion sur une classe CSS ou sur un inventaire de composants.**
- [x] **Morsure prouvée par neutralisation** — six mutations posées **au site du défaut**, arbre restauré et `git diff --exit-code` propre après chacune :

  | Mutation | Où | Rouges (suite entière) |
  |---|---|---|
  | `?offer=` lu sans confrontation au catalogue (`offerById` retiré) | `apps/web/app/pricing/page.tsx:60` | **0 / 1671** |
  | prix affiché remplacé par une constante | `pricing-table.tsx:149` — **dans le composant**, là où le prix est écrit | 3 |
  | entrée de navigation « Tarifs » passée `authenticated` | `billing-routes.ts:214` | 1 |
  | `notFound()` sur `billing.available` neutralisé | `pricing/page.tsx:68` | 1 |
  | clé `pricing.perYear` retirée de `fr.json` | `packages/modules/billing/src/messages/fr.json` | 3 |
  | `'pricing'` retiré de `APPLICATION_SEGMENTS` | `apps/web/lib/organizations.ts:147` | **0** (voir note) |

  Note sur la dernière : le retrait ne rougit pas parce que `reservedSlugs` dérive **aussi** le segment de `moduleRegistry.navigation`, et le module est activé. La garde n'existe que pour la configuration « billing coupé » — c'est une garde qui ne mord que dans un état, mais c'est une propriété **préexistante** du harnais, partagée avec `'billing'` et `'premium'`. La ligne est donc justifiée, pas du hors-sujet.

  **La table de mutations écrite dans `packages/modules/billing/AGENTS.md` est exacte** — j'ai rejoué les lignes clés, y compris la ligne à zéro, et elle ne surestime rien. C'est la bonne pratique du dépôt et il faut le dire.
- [ ] **Tests rendus redondants** : le cas de redirection forgée duplique `auth-rules.test.ts` — voir **F3**.

## Regressions

- [x] `BillingAction` reçoit une prop optionnelle avec défaut `false` : `/billing` inchangé, ses parcours e2e et ses cas de nœud verts.
- [x] L'entrée de navigation publique modifie la barre latérale de **tous** les visiteurs anonymes de l'application. Aucun cas existant ne compte les entrées ; `e2e/modules.spec.ts`, `e2e/app-shell.spec.ts` et `tests/module-registry.test.ts` restent verts.
- [x] `tests/rendered-text.test.ts` : deux écrans ajoutés au balayage, planchers de marqueurs respectés, garde-fou de prose toujours actif dans les props exemptées (`technical && !PROSE.test(trimmed)`, `rendered-text.test.ts:537`).
- [x] Aucun autre appelant de `billingCatalogue()`, `formatOfferPrice`, `offerById`, `billingNavigation` n'est cassé : suite complète + e2e complet verts.

## Findings

- **F1 — major — `apps/web/app/billing-actions.tsx:50,62,131` et `apps/web/app/pricing/page.tsx:127,138` — le `autoFocus` ne fait rien, et le code affirme le contraire.**
  ADR 045 décide : « met la carte correspondante en évidence **et donne le focus à son bouton** ». La mise en évidence marche ; le focus, non. **Mesuré au navigateur**, deux fois : (a) visite directe de `/pricing?offer=pro-monthly` avec session → `document.activeElement.tagName === 'BODY'`, `document.querySelectorAll('button:focus').length === 0` ; (b) aller-retour réel — anonyme sur `/pricing`, clic « Souscrire », connexion — → même résultat, `{"tag":"BODY","focusedButtons":0}`, alors que l'URL est bien `/fr/pricing?offer=pro-monthly` et qu'une carte porte `aria-current="true"`.
  Cause : le `<Button autoFocus disabled={pending || !hydrated}>` est **désactivé** au moment où React applique l'`autoFocus` (`useHydrated` rend l'instantané serveur `false` au premier rendu client) ; `.focus()` sur un élément désactivé est sans effet, et le re-rendu qui rallume le bouton ne repose jamais le focus. Sur la branche anonyme la prop est posée sur un `<Link>`, donc un `<a>`, que React n'auto-focalise dans aucun cas.
  Ce qui aggrave : le commentaire de `billing-actions.tsx:44-49` affirme « React ne pose le focus qu'à l'hydratation, **ce qui tombe juste** », le message de commit répète « focus sur son bouton », et `packages/modules/billing/AGENTS.md:227` aussi. Trois affirmations mesurables, fausses, qu'aucune commande ne contredit. Aucun test n'assertit le focus.

- **F2 — major — `apps/web/app/pricing/page.tsx:54-61` — l'exigence de test de l'ADR 045 n'est pas tenue : neutraliser la confrontation au catalogue ne rougit rien.**
  ADR 045, Consequences : « `?offer=` devient une entrée utilisateur : elle est validée par Zod contre le catalogue… **Un test doit échouer si quelqu'un la lit sans la valider.** » Remplacer `offerById(catalogue, parsed.data)?.id ?? null` par `parsed.data` laisse **1671 cas verts sur 1671**, suite entière, pas seulement le bloc de la page.
  L'implémenteur a documenté le trou honnêtement (commentaire de cas dans `tests/billing.test.ts` et ligne à `0` dans la table de `AGENTS.md`), et c'est mieux que de le taire. Mais la règle du dépôt est explicite : « A green mutation means the test is wrong, not that the code is right… fix the test. » Et le trou est refermable sans test de forme : `selectedOfferOf` est une fonction pure ; exportée — ou déplacée dans `domain/pricing.ts` à côté de `highlightedOfferId` — `selectedOfferOf('inconnu', catalogue) === null` rougit au site même du défaut. Le code est correct aujourd'hui ; c'est le filet qui manque, sur la seule entrée utilisateur de l'écran.

- **F3 — minor — `tests/billing.test.ts:3770-3772` — le cas de redirection forgée duplique une règle déjà éprouvée ailleurs, et laisse le vrai aller-retour non couvert.**
  `safeRedirectPath('https://evil.test/pricing', …)` et `'//evil.test/pricing'` sont déjà assertés à `packages/modules/auth/src/domain/auth-rules.test.ts:128` et `:132`. Seule la première moitié du cas (`safeRedirectPath(back, '/') === back` pour chaque offre) est spécifique à cet écran. Le plan demandait la vérification « **sur cette page précise** » ; ce qui est propre à cette page — le `next` produit ici traverse la connexion et ramène sur l'offre — n'est vérifié nulle part : `e2e/billing.spec.ts:343` s'arrête à l'URL de connexion. Je l'ai exercé moi-même et **ça marche** (sonde jetable, supprimée) : c'est donc un trou de couverture, pas un défaut.

- **F4 — minor — `docs/plans/s22-pricing-page.md`, tâches 1, 2 et 7 cochées malgré trois écarts non consignés.**
  (a) Tâche 1 : `pricing.checkoutFailed` et `pricing.retry` non ajoutées. **Écart justifié** — `BillingAction` rend déjà l'`Alert` de refus depuis `BILLING_KEYS.refusal.*` et le bouton est lui-même le moyen de réessayer ; deux clés de plus auraient été mortes. Conséquence assumable : l'erreur s'affiche par carte et non « au-dessus de la grille » comme le dit le design.
  (b) Tâche 2 : le cas de navigation vit dans `tests/billing.test.ts` et non dans `tests/module-registry.test.ts`. **Écart favorable** — il y réemploie les fixtures `registry` / `withoutBilling` et éprouve donc les deux configurations dans la même exécution, ce que le fichier prévu n'aurait pas donné.
  (c) Tâche 7 : le cas de redirection reformulé — voir F3.
  Le défaut n'est pas les écarts, c'est qu'une tâche cochée sans note laisse croire au lecteur suivant qu'elle a été faite telle qu'écrite.

- **F5 — minor — `docs/designs/s22-pricing-page.html` vs `packages/modules/billing/src/presentation/pricing-table.tsx` — deux éléments de la maquette disparaissent sans trace.**
  La liste de bénéfices par offre (`<ul><li>` aux lignes 87, 96, 105 de la maquette, « liste » dans le schéma du design) et le `Badge` « Paiement unique » de l'offre `one_time` ne sont pas rendus. Le premier abandon est **le bon choix** — aucune source de données n'existe et en créer une exigerait un champ de `config/billing.ts` que le plan interdit ; le second est compensé par la ligne de périodicité « paiement unique ». Mais rien dans la branche ne dit que ces deux éléments ont été écartés délibérément, alors que le document de design les décrit encore. Même remarque pour l'état « Chargement » (`Skeleton`) : absent, conforme au dépôt (aucun `loading.tsx` nulle part), jamais consigné.

- **F6 — minor — `tests/rendered-text.test.ts:591` — l'exemption des prix est posée globalement, pas sur l'écran.**
  `...billingOffers.map((offer) => formatOfferPrice(offer, defaultLocale))` entre dans le `data` set commun : `29,00 €`, `290,00 €` et `490,00 €` échappent désormais au balayage de prose sur **tous** les écrans, pas seulement `/pricing`. Un prix codé en dur dans un autre écran ne rougirait plus. Le mécanisme par écran existe pourtant juste à côté (`technicalProps`), et `FIXTURE_BILLING_PRICE` couvrait déjà le cas de la fixture.

- **F7 — minor — `packages/modules/billing/src/index.ts:44` — `periodicityKeyOf` est exposé dans le barrel principal sans aucun appelant hors du module.**
  Ses seuls consommateurs sont `pricing-table.tsx:156` et son propre test, tous deux internes. `highlightedOfferId`, lui, est bien lu par la page. Surface publique sans client.

- **F8 — minor — `packages/modules/billing/AGENTS.md:220-221` — affirmation d'exhaustivité sans commande qui la garde.**
  « l'entrée de navigation des tarifs est `public`, et c'est **la seule** surface publique du module avec le webhook ». C'est **vrai aujourd'hui** — j'ai compté : `billing-routes.ts` déclare exactement deux `protection: { level: 'public' }`, lignes 172 (webhook) et 214 (tarifs) — mais rien ne rougit le jour où une troisième apparaît. C'est le motif que le `AGENTS.md` racine dit avoir attrapé trois fois dans ce dépôt. Écrire « deux à ce jour, mesurées sur `billing-routes.ts` » plutôt que « la seule ».

### Deux constats qui ne sont pas des défauts, mais qu'il faut avoir lus

- **Le critère 1 est plus étroit que sa formulation.** « Ajouter une offre la fait apparaître sans modifier la page » est vrai de la page — mais `PricingTable` appelle `intl.t(offerNameKey(offer.id))` et `intl.t(offerDescriptionKey(offer.id))`, et le traducteur **lève** depuis s09 quand la clé manque. Ajouter une offre à `config/billing.ts` sans ses deux clés dans chaque locale met la page en 500. Comportement **préexistant** (`billing-screen.tsx:114` fait pareil) et non introduit ici ; invisible au test parce que `renderPricing` stubbe `t` en identité. À savoir avant d'ajouter la quatrième offre.
- **ADR 045 annonce que la page devient « cacheable ».** Elle ne l'est pas : `pnpm build` la classe `ƒ (Dynamic)` et elle lit `currentViewer()` à chaque requête pour choisir entre lien et déclencheur. Aucune ligne de code à changer — c'est la phrase de conséquence qui promet plus que ce qui est livré.

## Not verified

Ce que cette revue **n'a pas** pu contrôler, et par quel geste humain le combler :

- **Aucun rendu sous build de production.** Le harnais e2e lance `next dev` (`playwright.config.ts:70`), et mes quatre captures aussi. Le CSS minifié, la charge RSC et surtout le **nonce CSP** sous `next build` / `next start` n'ont jamais été vus sur cet écran. → `pnpm build && pnpm --filter @repo/web exec next start`, ouvrir `/pricing` connecté et déconnecté, console ouverte, vérifier zéro violation CSP.
- **Stripe n'a jamais été appelé.** Tout tourne en `PAYMENTS_LOCAL_MODE=1`. Le critère 2 compare l'affichage au catalogue **local** ; la divergence qui facture vraiment un client — `amount: 2900` en face d'un prix Stripe à 39 € derrière le même `priceId` — est hors de portée de tout ce que j'ai exécuté. Le diff le dit honnêtement à trois endroits, ce qui est la bonne conduite, pas une couverture. → avant la première vente réelle, confronter chaque `amount` / `currency` de `config/billing.ts` au prix du `priceId` correspondant, avec des clés de test réelles, hors CI.
- **Le focus, côté aide technique.** J'ai mesuré `document.activeElement` (F1), pas ce qu'un lecteur d'écran annonce. `aria-current="true"` est posé sur un `<div data-slot="card">` — usage inhabituel hors liste de navigation. → passer VoiceOver ou NVDA sur `/pricing?offer=pro-yearly` et écouter ce qui est annoncé de la carte mise en avant.
- **Catalogue vide et catalogue à une seule offre, jamais rendus dans un navigateur.** L'`EmptyState` (sans action) et la grille `md:grid-cols-1` n'existent que dans `renderToStaticMarkup`. → mettre `config/billing.ts` à une offre, regarder la page, puis à zéro offre, regarder l'état vide, puis remettre.
- **Module `billing` coupé, jamais exercé en vrai.** La 404 et la disparition du lien sont prouvées par injection en nœud, et les deux cas e2e correspondants sont `test.skip`és dans la configuration livrée. → `pnpm ks toggle billing`, ouvrir `/pricing` (404 attendue) et vérifier que « Tarifs » a disparu de la barre latérale, puis retoggler.
- **Aucune locale autre que `fr` rendue.** Le catalogue `en` n'est vérifié que pour la complétude de ses clés. « one-time payment » et « Pick the plan that fits… » n'ont jamais été mis en page. → ouvrir `/en/pricing` à 375 px et vérifier qu'aucun libellé ne se tronque.
- **`pnpm run audit` et le scan de secrets non exécutés** — aucun changement de dépendance ni de surface de secret dans ce diff, mais je ne les ai pas lancés.

Deux sondes Playwright jetables ont été créées dans `e2e/` pour établir F1 et le succès de l'aller-retour, puis **supprimées** ; `git diff --exit-code` et `git status --porcelain` sont propres, vérifiés après chacune des six mutations et à la fin.

## Verdict

Rien ici ne casse un comportement existant, n'ouvre une faille, ni n'invente une API. Les deux constats majeurs sont d'un même genre : une promesse écrite dans un ADR accepté que le code ne tient pas (F1), et une exigence de test du même ADR qu'aucune commande n'applique (F2). Le premier coûte un confort de navigation à la population qui vient de créer un compte ; le second laisse sans filet la seule entrée utilisateur de l'écran, alors que le code, lui, est correct. Les deux se réparent au cycle suivant sans rien défaire.

## Reprise après revue (même branche, commit amendé `6107be0`)

Les deux constats **major** ont été refermés avant le ship, plus quatre mineurs.
Le portail autorisait pourtant le ship : ils ont été traités parce que F1 laissait
**trois affirmations fausses** dans le dépôt, ce que la règle « Never claim
exhaustiveness / a green mutation means the test is wrong » du `AGENTS.md` racine
range au même niveau qu'un défaut.

| Constat | Ce qui a été fait | Morsure prouvée |
|---|---|---|
| **F1** | Option (a) : le focus fonctionne vraiment. Nouveau crochet client `apps/web/app/use-focus-when-ready.ts` — il focalise **après** l'hydratation et refuse un nœud encore désactivé. La prop `autoFocus` de `BillingAction` est renommée `focusOnReady` : le nom lui-même portait l'affirmation fausse. ADR 045 redevient vrai tel qu'écrit, sans ADR successeur. | 1 rouge (branche connectée), 1 rouge (branche anonyme) |
| **F2** | `selectedOfferOf` déplacée dans `domain/pricing.ts` à côté de `highlightedOfferId`. Zod borne la forme, le catalogue borne les valeurs. | **1 rouge** — contre 0/1671 avant |
| **F6** | Exemption des prix ramenée à l'écran (`screenData` par écran) au lieu du `data` global : un prix codé en dur ailleurs rougit de nouveau. | 1 rouge, 4 fautifs |
| **F7** | `periodicityKeyOf` retirée du barrel principal — surface publique sans client. | — |
| **F8** | Affirmation d'exhaustivité remplacée par une mesure datée : « balayage du 3 septembre 2026 sur `billing-routes.ts` : deux déclarations `public` à ce jour — webhook `:172`, entrée tarifs `:214` ; aucune commande ne rougit sur une troisième. » | — |
| **F4 / F5** | Écarts consignés : plan annoté (*Fait autrement* sur les tâches 1, 2, 7), design complété d'une section « Écarts assumés à l'exécution » (liste de bénéfices, badge « Paiement unique », `Skeleton`, erreur rendue dans la carte). | — |

**F3 non traité** comme prévu, mais le trou de couverture qu'il nommait est
refermé incidemment : le nouveau parcours e2e traverse la vraie connexion et
revient sur l'offre, là où `e2e/billing.spec.ts:343` s'arrêtait à l'URL.

### Une correction apportée à cette revue elle-même

La cause avancée en F1 — « sur la branche anonyme la prop est posée sur un
`<Link>`, que React n'auto-focalise dans aucun cas » — est **mesurablement
fausse sur Chromium** : React émet bien l'attribut `autofocus` dans le HTML
servi, et le navigateur l'applique nativement à un `<a>`. La première exécution
e2e de la reprise passait cette assertion et n'échouait que sur la branche
connectée. Seule la première cause du constat tenait : le `<Button>` est
`disabled` quand React applique l'`autoFocus`. Le correctif ne porte donc que
sur la branche connectée.

### Contre-vérification indépendante (contexte principal, après reprise)

Rejoué sans se fier au compte rendu : mutation de `selectedOfferOf` reposée à la
main → **rouge** (`ignore un identifiant que le catalogue ne connaît pas`), arbre
restauré et `git diff --exit-code` propre. Puis `pnpm typecheck` 24 tâches vertes,
`pnpm lint` sans anomalie, `pnpm test` **1674 passés / 8 sautés**, `pnpm test:e2e`
**86 passés / 8 sautés**. Un seul commit sur la branche, portant recherche,
design (`.md` + `.html`), plan et ADR 045.

### Ce qui reste ouvert, hors périmètre de cette story

`/pricing` n'entre pas dans `marketingSite.publicPaths` : `seo.ts:92` construit
la politique en `disallow: ['/']` avec un `allow` ancré par chemin public, donc
la page de tarifs est **interdite d'indexation**. Pour un boilerplate SaaS, c'est
la page à plus forte intention commerciale. La réponse est structurelle et
appartient à une story dédiée : dériver `publicPaths` de l'union des entrées de
navigation `public` des modules actifs — le module `billing` en déclare
désormais une — plutôt que du seul module marketing.

Max severity: major
Ship allowed: yes
