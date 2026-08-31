---
story: s45-security-headers
validated: yes
---

# Plan — s45-security-headers

Recherche : `docs/research/s45-security-headers.md`. Pas de `/ks-design` : la
story n'a pas d'écran.

**Sections du socle touchées** — `docs/security.md` **§1** en entier (c'est la
story qui l'implémente), **§5** (aucune lecture directe de `process.env` :
`NODE_ENV` passe par `@repo/config`), **§6** (une dépendance ajoutée,
justifiée ici). `docs/reliability.md` **§2** (le collecteur de rapports ne
dépend d'aucun service tiers et n'existe qu'en développement) et **§5**
(tampon borné).

**Justification écrite exigée par §1** — aucune source tierce n'est ajoutée par
cette story. `config/security.ts` livre des listes **vides** ; la politique de
production ne contient aucun hôte. Les seuls assouplissements sont bornés au
développement et nommés dans la tâche 2.

## Tâches

- [x] **1. La configuration unique des sources** — `config/security.ts` : les
      listes de sources tierces par directive, vides à la livraison, avec la
      règle de justification écrite en commentaire. Type déclaré sur place, comme
      `config/i18n.ts`. *Comportement* : un consommateur ne peut lire une source
      que d'ici.
      Test : `tests/security-headers.test.ts` — la politique construite avec une
      configuration sentinelle porte exactement les sources déclarées, et la
      politique construite avec la configuration **livrée** ne contient aucun
      hôte (`http`, `https://`, `*`).

- [x] **2. Le constructeur de politique** — `apps/web/lib/security-headers.ts` :
      fonction pure `securityHeaders({ mode, nonce, sources, reportPath })`
      rendant les six en-têtes du socle §1. Mode `production` : `default-src
      'self'`, `script-src 'self' 'nonce-…' 'strict-dynamic'`, `style-src 'self'
      'nonce-…'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`,
      `frame-ancestors 'none'`, `upgrade-insecure-requests`. Mode `development` :
      **deux** assouplissements et pas un de plus — `'unsafe-eval'` dans
      `script-src` (React reconstruit les piles serveur par `eval`, mesuré) et
      `'unsafe-inline'` dans `style-src` (Turbopack injecte le CSS par
      JavaScript), plus `report-uri`. **Jamais `'unsafe-inline'` dans
      `script-src`**, même en développement.
      Test : mode production sans aucun mot-clé permissif ; mode développement
      avec exactement ces deux-là ; `HSTS` ≥ 1 an + `includeSubDomains` ;
      `nosniff` ; `strict-origin-when-cross-origin` ; `Permissions-Policy`
      refusant caméra, micro et géolocalisation ; `X-Frame-Options: DENY`.

- [x] **3. `NODE_ENV` par le point d'accès unique** — `getNodeEnv()` dans
      `@repo/config` : accesseur étroit qui ne juge que cette variable et
      retombe sur `development`, sans exiger le reste de l'environnement.
      Test : `packages/config/src/env.test.ts` — valeur reconnue, valeur absente,
      valeur inconnue ; aucune levée sur un environnement sans `DATABASE_URL`.

- [x] **4. Le proxy pose les en-têtes, et le préfixe de locale ne bouge pas** —
      `apps/web/proxy.ts` : nonce par requête (`crypto.randomUUID`), politique
      posée sur les en-têtes de la **requête** (sans quoi Next n'a pas de nonce à
      poser sur ses balises) **et** sur la réponse, `x-nonce` transmis aux
      composants serveur. `matcher` élargi à `/api` et aux chemins à point ;
      l'exclusion du préfixe de locale devient une condition interne, à
      comportement identique.
      Test : réponse **réellement rendue par `proxy()`** — en-têtes présents sur
      une page, sur `/api/health` et sur `/robots.txt` ; nonce différent d'une
      requête à l'autre ; le nonce de l'en-tête de requête est celui de la
      réponse ; `/robots.txt` et `/api/…` ne sont **pas** redirigés vers une
      forme préfixée ; sous `NODE_ENV=production`, la politique servie ne
      contient ni `unsafe-inline` ni `unsafe-eval`.

- [x] **5. Le nonce atteint ce que les bibliothèques injectent** —
      `apps/web/app/layout.tsx` lit `x-nonce` et le passe à `ThemeProvider`
      (`next-themes` le pose sur son script **et** sur son `<style>`) et à un
      composant client de `@repo/ui` qui appelle `setNonce` de `get-nonce`, seule
      voie documentée pour que `react-remove-scroll` nonce le `<style>` du
      verrou de défilement. Dépendance ajoutée : `get-nonce` (§6 du socle),
      justifiée ici.
      Test : le verrou de défilement est un comportement navigateur — couvert par
      le parcours de la tâche 7 (aucune violation en console) plutôt que par un
      test synthétique. Le câblage `x-nonce` → `ThemeProvider` est vérifié sur le
      HTML rendu.

- [x] **6. Le dernier attribut `style` servi disparaît** — `packages/ui` :
      `AccordionContent` neutralise les deux variables que Radix écrit toujours
      et qu'aucune règle du design system n'utilise. Sans cela, `/fr` et `/en`
      émettent un attribut `style` que la politique refuse — sans effet
      fonctionnel mesuré, mais avec une violation en console à chaque visite.
      Test : le HTML rendu par la page d'accueil ne contient aucun attribut
      `style`.

- [x] **7. Le collecteur de rapports, en développement** —
      `apps/web/app/api/csp-report/route.ts` : `POST` enregistre (tampon borné à
      50) et journalise, `GET` rend les rapports collectés. **404 en
      production**, comme la sonde de s09. Aucun service tiers.
      Test : `tests/security-headers.test.ts` sur les deux modes ; parcours
      Playwright pour le bout en bout.

- [x] **8. Le parcours qui prouve le blocage** — `e2e/security-headers.spec.ts` :
      en-têtes présents sur une page et sur l'API ; un script en ligne **sans
      nonce injecté dans le HTML servi** ne s'exécute pas ; le collecteur a reçu
      le rapport correspondant ; une visite normale (accueil, thème, panneau
      mobile, navigation) ne produit **aucune** violation.

- [x] **9. Les règles suivent le code** — `apps/web/AGENTS.md` (le proxy voit
      désormais `/api`, ce qu'il pose, et pourquoi la source est unique),
      `packages/ui/AGENTS.md` (`get-nonce` autorisé, et pourquoi), `.env.example`
      si une variable apparaît (aucune n'est prévue).

## Vérifications finales

`pnpm typecheck`, `pnpm lint --max-warnings=0`, `pnpm test`,
`E2E_PORT=3145 pnpm test:e2e`, `pnpm build`, `pnpm run audit`, plus une
vérification navigateur sur le **build de production** (hydratation, thème,
panneau mobile, navigation, console vide).

## Corrections après revue (`docs/reviews/s45-security-headers.md`)

Le rapport conclut `Max severity: major`, `Ship allowed: yes`. Les constats sont
fermés avant fusion, majeur d'abord.

- [x] **C1 — la page 404 (et la page 500) violaient la politique livrée.**
      `apps/web/app/not-found.tsx` et `apps/web/app/global-error.tsx`, composés
      avec `PageHeader`, `EmptyState` et `Button` du design system — aucun
      composant ni jeton inventé. Textes par les catalogues ; ceux de l'écran de
      dernier recours passent par `apps/web/lib/fallback-text.ts`, qui lève sur
      une clé absente comme le reste du dépôt (il n'a ni provider ni locale de
      requête, puisqu'il remplace `app/layout.tsx`).
      Contrôles : `tests/rendered-text.test.ts` rend les deux écrans avec le
      catalogue pseudo-locale et les fait entrer dans sa garde de couverture ;
      **`e2e/security-headers.spec.ts` juge le HTML servi sur une URL
      inexistante** — c'est le contrôle qui ferme la classe, pas seulement le
      cas.

- [x] **C2 — la justification du câblage des en-têtes de requête était fausse.**
      Sur le runtime Node de Next 16.3.3, `resolve-routes.js` recopie chaque
      en-tête de réponse du proxy sur `req.headers` : la politique atteint le
      rendu de toute façon. Le câblage est conservé (voie explicite, probablement
      porteuse en runtime **edge**, non mesuré) ; `proxy.ts`, `apps/web/AGENTS.md`
      et la recherche §1 disent désormais ce qui a été mesuré.

- [x] **C3 — « à comportement identique » était faux.** `carriesLocalePrefix`
      reprend les **quatre** alternatives de l'ancien motif (`api`, `_next`,
      `favicon.ico`, un point n'importe où). Six sondes dans
      `tests/security-headers.test.ts`, dont `/v1.2/page` et `/_next/…`.

- [x] **C4 — `frame-src` perdait `'self'`.** Une source déclarée s'ajoute
      désormais, comme partout ailleurs ; les **sept** clés de
      `ContentSecurityPolicySources` sont exercées par un cas, et l'état livré
      (`'none'`) par un autre.

- [x] **C5 — injection de journal dans le collecteur.** Les champs du rapport
      sont normalisés à l'entrée (tout caractère de contrôle, pas seulement
      `\n`), tampon et journal compris.

- [x] **C6 — dérive de signature.** `securityHeaders({ mode, nonce, sources,
      reportPath })`, la signature que la tâche 2 spécifie.

- [x] **C7 — la justification du mode invoquait un précédent qu'elle ne suit
      pas.** Le collecteur dérive de `NODE_ENV`, il n'a pas le drapeau explicite
      de s09 ; et ce qui protège n'est pas le repli de `getNodeEnv` — le plus
      permissif des deux — mais la validation au démarrage, désormais éprouvée
      par un cas de `packages/config/src/env.test.ts`.
