# Review — s37b2-back-office-lecture

> Contexte neuf. Diff jugé : `git diff dev...feature/s37b2-back-office-lecture` (61 fichiers, +4757/−89). Arbre vérifié propre après chaque mutation.

## Ce que la revue a joué elle-même

| Commande | Résultat |
|---|---|
| `pnpm test` | 2646 verts, 11 sautés, 0 échec |
| `pnpm typecheck` | 33/33 |
| `pnpm lint` | aucun problème |
| `pnpm build` | vert, les quatre écrans émis |
| `E2E_PORT=3102 pnpm test:e2e` | **113 verts, 8 sautés**, dont les deux cas de `e2e/admin.spec.ts` |
| `pnpm test:minimal-profile` | vert (10 modules coupés, 33 routes et 10 entrées balayées) |
| `pnpm test:socle` | vert — et `e2e/admin.spec.ts` **passe avec `organizations` coupé** |
| `pnpm test:sans-env` | vert (93 fichiers) |
| `pnpm test:contrast` | 10/10 au-dessus d'AA |

Preuves navigateur : les quatre écrans plus le bandeau, à 1280 px et 390 px. **Débordement horizontal mesuré à 390 px : 0 px** sur les deux listes. Une session empruntée reçoit bien `Page introuvable` sur `/admin/users` — la garde tient à travers la coquille.

## Mutations

| # | Neutralisé, à son propre site | Rouges |
|---|---|---|
| 1 | `authorize`, contrôle de rôle → `if (false && …)` | **9** — les 4 vues et les 5 cas de route |
| 2 | `authorize`, refus de session empruntée | **2** |
| 3 | `surface: 'admin'` retiré de `adminNavigation` | **2**, dont « ne paraît jamais dans la barre latérale » |
| 4 | `surface: 'admin'` retiré de l'entrée `organizations` | **2** |
| 5 | `escapeLikePattern` contourné dans les deux recherches | **2** |
| 6 | `superadminsAmong` → `return []` | **0 dans `pnpm test`** ; 1 rouge dans `e2e/admin.spec.ts` |

Il n'existe **aucune seconde copie** de la garde : un seul `authorize`, appelé par l'enveloppe de route et par les quatre cas d'usage.

## Réponses aux points soumis

**Le doute de l'implémenteur sur `surface: 'admin'` est trop pessimiste** : `tests/admin.test.ts` asserte que la barre latérale du produit ne porte aucune entrée `admin:*`, et la mutation 3 la rend rouge. Reste un trou sans gravité : un **futur** module déclarant une entrée de surface admin sans le champ fuirait, avec seulement le test de dérivation pour l'attraper.

**404 sur le vrai chemin HTTP, vérifié hors tests unitaires** : `e2e/admin.spec.ts:82` obtient 404 pour un connecté non-superadmin, et 404 + `{error:'not_found'}` sur les deux nouvelles routes POST. Toutes les nouvelles routes déclarent `authenticated`, jamais `role` : la branche 403 du répartiteur leur est inatteignable.

**La branche formulaire** : les quatre `<form>` ajoutés déclarent `method` en littéral. `isFormSubmission` teste `content-type`, donc le contrat JSON de s37b1 est intact. Aucune ouverture CSRF : le cookie de session est `SameSite=Strict`.

**Les deux défauts trouvés par les recettes tiennent.** `admin.available` est vérifié **avant** la redirection de session sur les quatre pages ; le bandeau prend ses libellés du catalogue applicatif. **Aucune troisième occurrence** de la forme « garde après une redirection » : tous les `redirect(` de `apps/web/app/**` ont leur porte de module en premier.

**La discipline de `PlatformScope` tient** : le scope reste le premier paramètre, `{ kind: 'platform' }` n'est écrit qu'à un seul endroit, et aucune valeur de scope ne vient d'une requête.

**`ModuleSession.roles` vaut toujours `[]`** — confirmé à `better-auth-service.ts:1111`. La story ne s'appuie pas dessus, et le commentaire du code énonce le fait correctement.

**Aucun écran ne démarre une impersonation — le critère 6 reste satisfait** : il demande un bandeau **permanent** survivant à une navigation complète, mesuré dans le navigateur sur deux navigations. Mais le produit livre un bandeau pour un état qu'aucune interface ne permet d'atteindre : à écrire dans `docs/stories.md`, pas un défaut de ce diff.

## Constats

**F1 — major — `packages/core/src/module.ts:246`** — `NavigationSurface` gagne une troisième valeur **sans ADR**, alors que l'ADR 066 (accepté l'avant-veille) écrit lui-même que le précédent du dépôt pour un changement de contrat est un ADR, et pose la question à surveiller : *« une troisième surface… est-ce encore une propriété de l'entrée ou une propriété de l'écran qui la rend ? »* Le diff ajoute la valeur, argumente par analogie dans un commentaire, et ne répond pas. C'est le constat que la revue de s31 avait déjà fait une fois.

**F2 — major — `docs/design-system.md:198-202` laissé périmé par la story qui l'invalide.** La note datée dit que `Table` n'existe pas ; cette story le livre. `packages/ui/AGENTS.md` a été mis à jour, et ce même fichier dit « le document fait foi, pas ce tableau » : l'autorité annoncée est inversée. *Docs ship with the code that changes them.*

**F3 — major — `apps/web/app/app-shell.tsx:105` + `apps/web/lib/admin.ts`** — deux allers-retours de base supplémentaires **à chaque rendu de page authentifiée, dans toutes les configurations**, non mesurés. `currentImpersonation` re-résout la session depuis le cookie (better-auth `getSession`) **plus** `sessions.findById`, une ligne après que la coquille l'a déjà résolue. Il tourne **même module `admin` coupé**. Le harnais qui compte les requêtes ne compte que les rendus **anonymes** : ce coût est invisible à toute commande.

**F4 — major — `packages/ui/src/composed/pagination.tsx:47` utilisé sans borne sur des listes de plateforme.** `Pagination` rend un `<a>` par page ; le domaine autorise jusqu'à 10 000 pages, soit 10 000 ancres. Le composant a été écrit pour le blog (s29). La pagination **fenêtrée** manquante est un **quatrième manque du design system**, ni reporté ni borné — alors que le document en reporte trois.

**F5 — minor — `drizzle-platform-role-repository.ts:252`** — `superadminsAmong` renvoyant `[]` laisse les 2646 cas verts ; seul le navigateur rougit. La colonne « Droits » dirait « aucun droit » pour tout le monde, superadmins compris — c'est le critère 1.

**F6 — minor — `back-office-screens.tsx:695`** — une seconde copie d'un chemin déclaré « écrit une fois : deux copies divergeraient ». Exactement la forme P30.

**F7 — minor — `back-office-screens.tsx:123-126`** — deux clés de traduction construites depuis des vocabulaires étrangers (`billing`, `organizations`) sans commande qui rougisse quand ils dérivent. `intl.t` lève : un septième état d'abonnement ou un quatrième rôle transforme l'écran en 500.

**F8 — minor — `apps/web/messages/{fr,en}.json`** — le bandeau **ne nomme pas** le compte emprunté, alors que le design l'exige. Écart au design, pas trou de sûreté.

**F9 — minor** — `roles: []` inconditionnel : tout `protection: {level:'role'}` n'est satisfait par personne. Fait préexistant, correctement écrit dans le code, mais qu'aucune commande ne nomme.

**F10 — minor — `admin-routes.ts:85-92`** — un appelant JSON qui omet `Content-Type` reçoit désormais 400. Aucun appelant du dépôt n'est dans ce cas ; exposition externe seulement.

## Non vérifié

- **Le build de production n'a jamais été exercé dans un navigateur** : `next start` refuse de démarrer ici (modes locaux, aucune clé fournisseur). Toutes les preuves navigateur sont sous `next dev`. **Geste humain** : ouvrir les quatre écrans sur un vrai déploiement et confirmer que le conteneur de la table défile au lieu de pousser la page, et que la CSP ne bronche pas.
- **Le thème sombre n'a jamais été regardé** : `pnpm test:contrast` ne couvre que l'`Alert` ; les jetons de la `Table` n'ont pas été mesurés.
- **Aucun lecteur d'écran** n'a été exercé sur la table.
- **Aucune charge au-delà de ~280 organisations / ~90 comptes.** F4 est arithmétique, pas mesurée à l'échelle.
- **Le coût de F3 a été lu, pas profilé.**
- **Stripe n'a jamais été appelé** : l'état d'abonnement affiché n'a jamais été produit par un événement réel.

Max severity: major
Ship allowed: yes
