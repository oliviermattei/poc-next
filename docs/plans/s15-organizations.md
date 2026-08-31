---
story: s15-organizations
validated: yes
---

# Plan — s15-organizations

Recherche : `docs/research/s15-organizations.md`.
Design : `docs/designs/s15-organizations.md` (+ `.html`).

**Sections des socles engagées** — `docs/security.md` **§2** (sessions ;
bloqueur de rotation déclaré en recherche §3), **§3** (autorisation serveur,
404 et non 403, résolution unique du propriétaire), **§4** (Zod à chaque
frontière, redirection à destination constante), **§7** (aucun refus qui
renseigne). `docs/reliability.md` **§1** (unicité par contrainte de base,
migration rejouable), **§4** (migration additive).

**Deux fichiers de test neufs** — `packages/modules/organizations/src/domain/organization-rules.test.ts`
(les règles pures) et `tests/organizations.test.ts` (le câblage). Un troisième
fichier de parcours, `e2e/organizations.spec.ts`, relève de Playwright et non de
la suite de nœud. Les cas ajoutés à `tests/module-registry.test.ts`,
`tests/rendered-text.test.ts` et `tests/fixtures/typing/` sont des ajouts dans
des fichiers existants.

---

## Tâches

- [x] **1. La résolution unique du propriétaire, dans `@repo/core`.**
      `resolveDataOwner({ session, activeOrganizationId })` rend un `ModuleScope`
      — organisation quand une organisation active est résolue, utilisateur
      sinon. Elle vit dans `@repo/core` parce qu'elle doit exister **module
      coupé**, et `@repo/core` ne connaît aucun module
      (`docs/architecture.md`, « Data model » ; `docs/security.md` §3).
      *Test* : `packages/core/src/protection.test.ts` — les deux branches, et
      le fait que l'appelant est le même.
      *Mutation* : rendre toujours `{kind:'user'}`.

- [x] **2. Le squelette du module `organizations`.**
      `packages/modules/organizations/` sur le modèle de `marketing` : deux
      points d'entrée (`.` et `./presentation`, ADR 024), `tsconfig.json`,
      `AGENTS.md` (trois sections, chaque dépendance nommée), catalogues
      `fr.json` / `en.json`. Contrat aux **14 clés**, `requires: ['auth']`.
      *Vérification* : `pnpm test -- tests/agents-md.test.ts` passe ; aucun
      `.tsx` dans le barril principal.

- [x] **3. Les règles pures du domaine.**
      `domain/organization.ts` : nom (Zod, 1-64 caractères, non vide après
      trim), slug (Zod, `^[a-z0-9]+(?:-[a-z0-9]+)*$`, 2-48), refus des slugs
      **réservés** reçus en paramètre, rôle du créateur = `owner`, et
      `SLUG_UNAVAILABLE` — **un seul** motif pour « réservé » et « déjà pris »
      (`docs/security.md` §7).
      *Test* : fichier neuf `domain/organization-rules.test.ts`.
      *Mutation* : retirer le refus des réservés ; distinguer les deux motifs.

- [x] **4. Le schéma et sa migration.**
      `schema.ts` : `organization` (slug unique **en base**),
      `organization_member` (unique `(organization_id, user_id)`, FK vers
      `organization` et vers `auth_user`, `onDelete: 'cascade'`),
      `organization_active_selection` (`user_id` clé primaire — l'organisation
      courante persiste **entre deux sessions**, elle n'est pas dans le
      cookie). La FK vers `auth_user` est permise parce que `auth` est un
      requis déclaré (ADR 018). Activation dans `config/features.ts`, puis
      `pnpm db:generate` (jamais `push`), puis `pnpm db:migrate` **deux fois**.
      *Vérification* : second passage à zéro migration appliquée
      (`docs/reliability.md` §1).

- [x] **5. L'autorisation, dans le prédicat.**
      `application/ports.ts` + `infrastructure/drizzle-organization-repositories.ts` :
      `authorizeOrganization({ userId, organizationId })` exécute **un seul**
      ordre portant `organization.id = ? and member.user_id = ?` et rend un
      `OrganizationAccess` **marqué** — le seul moyen d'en obtenir un. Aucune
      vérification préalable suivie d'une écriture.
      *Test* : `tests/organizations.test.ts` (base réelle).
      *Mutation* : remplacer le prédicat conjoint par une vérification
      préalable, puis par un `eq(organization.id, …)` seul.

- [x] **6. Les routes du module, et le 404.**
      `presentation/organization-routes.ts` : `POST /organizations/create`,
      `/switch`, `/update`, toutes `authenticated`, corps validé par Zod,
      réponse **303** vers une destination **constante**. Une organisation dont
      l'appelant n'est pas membre répond **404, jamais 403 ni 200**.
      *Test* : `tests/organizations.test.ts`, par le répartiteur.
      *Mutation* : passer le 404 à 403 ; passer le 404 à 200.

- [x] **7. Le porteur d'accès ne se fabrique pas.**
      Fixture `tests/fixtures/typing/forged-organization-access.ts` qui **doit
      échouer** à la compilation, plus son cas dans le `it.each` de
      `tests/module-registry.test.ts`.
      *Mutation* : retirer la marque de type — la fixture compile, le cas
      rougit.

- [x] **8. Le composé `OrgSwitcher`.**
      `packages/ui/src/composed/org-switcher.tsx`, exporté par le baril, ajouté
      au tableau de `packages/ui/AGENTS.md`. Aucun texte en dur, nom accessible
      obligatoire, options = boutons de soumission d'un `<form method="post">`.
      *Vérification* : `pnpm lint` (règle `method`), `pnpm test`
      (`tests/i18n.test.ts`, `tests/design-system.test.ts`), et le rendu
      navigateur consigné — **la mesure manquait au premier passage** (constat
      F6) ; elle est dans `docs/designs/s15-organizations.md`, § « Vérification
      visuelle » et § « Le clavier seul ».

- [x] **9. La présentation du module et son point de composition.**
      `presentation/organizations-screen.tsx` (second point d'entrée) ;
      `apps/web/lib/organizations.ts` — **le seul fichier de l'application qui
      nomme le module**, rendant une valeur de forme identique dans les deux
      états, et exposant `currentOwner()` (tâche 1). Les slugs réservés y sont
      **dérivés** : segments de tête de la navigation du registre + codes de
      locale + segments des écrans de l'application.
      *Test* : `tests/organizations.test.ts` — les segments réellement présents
      sous `apps/web/app` sont tous refusés.
      *Mutation* : retirer un segment de la liste écrite.

- [x] **10. L'écran.**
      `apps/web/app/organizations/page.tsx` : session exigée côté serveur
      (redirection sinon), **404 module coupé**, dérivé d'une donnée et jamais
      d'un `if (module activé)`. Ajout du cas dans
      `tests/rendered-text.test.ts` (sinon la garde de couverture rougit), avec
      son refus attendu selon l'état du module.
      *Vérification* : `pnpm test`, plus la capture visuelle des deux thèmes et
      de 390 px — **refaite après la revue**, avec zéro, une et trois
      organisations, et ses nombres consignés dans
      `docs/designs/s15-organizations.md`.

- [x] **11. Purge, export, rétention.**
      Les quatre clés du contrat, réellement branchées : périmètre utilisateur
      (appartenances + sélection active) et périmètre organisation (l'organisation
      et sa descendance par cascade). `dataCategories`
      `['organization', 'membership']`, `retention` `erase` pour les deux.
      *Test* : `tests/organizations.test.ts` — purge rejouée deux fois, un seul
      effet.

- [x] **12. Le parcours navigateur.**
      `e2e/organizations.spec.ts` : créer, basculer, renommer, et la persistance
      de l'organisation courante **entre deux sessions** (déconnexion puis
      reconnexion). Attentes **dérivées** de l'état du module, pour passer dans
      les deux configurations.

- [x] **13. Les documents qui vieillissent avec le code.**
      `apps/web/AGENTS.md` (le nouveau point de composition, le nouvel écran),
      `packages/ui/AGENTS.md` (le composé copié), `packages/db/AGENTS.md` si la
      garde de référence le demande. Aucune modification de `docs/architecture.md`
      ni d'`AGENTS.md` racine (hors périmètre de l'implémenteur).

- [x] **14. Les deux configurations.**
      Suite complète module activé, puis `pnpm ks toggle organizations`, suite
      complète à nouveau, puis remise en marche et arbre vérifié propre.

---

## Écarts constatés à l'exécution

Consignés ici parce qu'un plan qui ment sur ce qui a été fait est pire qu'un
plan absent. Le détail des mesures est dans le compte rendu de la story.

1. **`pnpm ks` ne sait pas générer un module** (`list` et `toggle` seulement — le
   scaffolding est s41). Le squelette est calqué à la main sur
   `packages/modules/marketing`.
2. **Le plugin `organization` de Better Auth n'est pas employé** : il ajoute
   `activeOrganizationId` à la table `session`, donc à une table du module
   `auth`. La colonne survivrait à la coupure du module — le critère « tables
   absentes d'une base vierge » tomberait. Mesure et arbitrage :
   `docs/research/s15-organizations.md` §2.
3. **La rotation de l'identifiant de session à la bascule d'organisation n'est
   pas livrée** : elle exige un point d'entrée dans le module `auth`, hors
   périmètre de cette voie. La conception rend la rotation sans objet — le
   jeton de session ne porte aucune autorité organisationnelle — et c'est
   éprouvé, mais le point reste à trancher (recherche §3).
4. **Tâche 9 — `currentOwner()` est devenue `dataOwnerOf(session)`** : lire le
   cookie dans ce fichier importait `next/headers`, ce qui le rendait
   inutilisable par les parcours Playwright, qui en dérivent leurs attentes.
5. **Une pièce non prévue au plan : `apps/web/lib/module-services.ts`.** Le
   répartiteur monte les routes mais ne construit rien, et rien dans le chemin
   d'une requête d'API n'importait le point de composition du module : la
   première soumission répondait 500. Le fichier dit **comment** construire, il
   ne construit pas — sans quoi répondre 404 sur un chemin inconnu ouvrirait
   une base.
6. **Tâches 5, 6, 9 et 11 : le code a précédé son test de câblage.** Les règles
   pures (tâche 3) et `resolveDataOwner` (tâche 1) ont bien été écrites en
   test-first. Les invariants de ces quatre tâches sont éprouvés par mutation,
   pas par l'ordre d'écriture.

---

## Tour de correction (après la revue `docs/reviews/s15-organizations.md`)

Sept constats, tous fermés. Chacun avec sa commande et sa mutation ; le détail
constat par constat est dans la section de clôture du rapport de revue.

- [x] **F1 — critique. Le propriétaire résolu peut être une organisation
      quittée.** `activeOrganizationIdOf` joint la sélection courante à
      `organization_member` sur le **compte**. La ligne de sélection n'est pas
      nettoyée : c'est la lecture qui filtre.
      *Test* : `tests/organizations.test.ts` — « cesse de résoudre vers une
      organisation qu'on a quittée », avec un **second membre** dans
      l'organisation, sans quoi une jointure qui oublie le compte passerait
      (mesuré : elle passait).
      *Mutations* : jointure retirée → 1 rouge ; jointure sans le prédicat de
      compte → 1 rouge.

- [x] **F2 — majeur. « L'oubli du périmètre est impossible » n'était tenu par
      aucune commande.** Les lectures du module sont réunies dans
      `infrastructure/scoped-reads.ts`, seul fichier où `select`, `from` et
      `execute` sont permis (`eslint.config.ts`) ; chaque fonction prend le
      propriétaire en premier paramètre.
      *Test* : `tests/lint-rules.test.ts` rejoue la sonde de la revue.
      *Mesure* : la sonde réintroduite pour de vrai fait échouer `pnpm lint`.
      *Mutations* : garde retirée → 4 rouges ; reprise des sélecteurs du bloc
      précédent retirée (piège de la configuration plate) → 2 rouges.
      Les phrases trop larges sont corrigées là où elles étaient écrites :
      `organization-access.ts`, `schema.ts`, `AGENTS.md` du module, recherche
      §3 et §4.

- [x] **F3 — majeur. Le diff contredisait l'ADR 004 sans ADR superséquent.**
      `docs/decisions/025-organisation-active-hors-plugin-better-auth.md`
      (MADR, cinq options rejetées), et l'ADR 004 marqué supersédé **sur ce seul
      point** — sa décision sur Better Auth comme socle ne bouge pas.

- [x] **F4 — mineur. `apps/web/AGENTS.md` nommait `currentOwner()`.** Remplacé
      par `dataOwnerOf(session)`, avec ce qu'elle rend et quand.

- [x] **F5 — mineur. Le garde-fou de prose était desserré globalement.**
      `create`, `switch` et `update` sortent de `TECHNICAL_PROPS` et deviennent
      des props techniques **de l'écran des organisations** (`technicalProps`).
      `role` reste global : c'est un attribut HTML réel.
      *Mutations* : exception d'écran retirée → 1 rouge (3 offenders) ;
      exception déclarée sur un **autre** écran → 1 rouge.

- [x] **F6 — mineur. Une vérification cochée sans trace.** Mesure refaite :
      neuf captures (0/1/3 organisations × 1280 clair, 1280 sombre, 390),
      débordement horizontal et thème appliqué relevés, plus le parcours au
      clavier seul du menu portalisé. Dans
      `docs/designs/s15-organizations.md`.

- [x] **F7 — mineur. « Aucune organisation » pouvait s'afficher comme
      organisation courante.** Clé `current.none` (« Choisir une organisation »
      / « Choose an organization ») ; l'état vide reste l'état vide.
      *Test* : `tests/organizations.test.ts`, rendu statique de l'écran.
      *Mutation* : retour à `emptyTitle` → 1 rouge.

- [x] **Arbitrage 2 — la conséquence de la sélection par compte est écrite.**
      Une écriture future dérivée de `dataOwnerOf` peut atterrir dans
      l'organisation basculée dans un autre onglet : consigné dans l'ADR 025 et
      dans l'`AGENTS.md` du module.

- [x] **Arbitrage 3 — la bascule sans JavaScript.** Un `<noscript>` dans le
      `<form method="post">` déjà présent, portant les mêmes options en boutons
      de soumission natifs, l'organisation courante exclue. Aucun composant ni
      jeton nouveau, rien d'inline (la CSP interdit `unsafe-inline`).
      *Test* : `e2e/organizations.spec.ts`, contexte `javaScriptEnabled: false`
      — écrit avant, vu rouge, puis vert.
