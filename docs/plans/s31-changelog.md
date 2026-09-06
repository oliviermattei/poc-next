---
story: s31-changelog
validated: yes
---

# Plan — s31-changelog

> Planifié contre `dev` au commit `371e496`. La recherche est datée de `445d969`, **50 commits plus tôt** : quatre de ses cinq faits tiennent, le premier a été **résolu entre-temps** — voir ci-dessous.

## Ce que la recherche disait, et ce qui a bougé depuis

1. **Fait 1 — périmé, et dans le bon sens.** Elle craignait que le lien du pied de page devienne « un quatrième import nommé, aux trois mêmes endroits ». `MarketingFooter` porte désormais `extraLinks` (`marketing/src/presentation/marketing-footer.tsx:54`), et `s53` l'a câblé. Mais le nommage a seulement **déménagé d'un cran** : `consentFooterLinks` est importé nommément dans **sept fichiers** de `apps/web/app` (3 via `footerLinks`, 4 via `extraLinks`). Ajouter le changelog par le même chemin serait un second nom dans les mêmes sept fichiers. **C'est la tâche 7.**
2. **Fait 2 — tient.** `renderBlogFeed` vit toujours dans `packages/modules/blog/src/domain/feed.ts:82`, et c'est le seul constructeur de flux du dépôt. Le réutiliser tel quel imposerait `requires: ['blog']` au changelog : un produit qui coupe le blog perdrait ses nouveautés.
3. **Fait 3 — confirmé, et c'est la troisième fois.** L'échelle de prose est montée dans `packages/ui/src/composed/prose.tsx` (s30) ; le balayage de contenu est resté dans le blog (`infrastructure/content-directory.ts`) ; le constructeur de flux est réclamé ici. **On lui donne un toit maintenant** (tâche 2), on ne le repaye pas une quatrième fois.
4. **Fait 4 — tient.** Le tri sémantique est le seul piège algorithmique.
5. **Fait 5 — tient.** Le dépôt n'embarque **aucun validateur de flux**, seulement `@rowanmanning/feed-parser`, un analyseur dont la revue de s53 a mesuré la complaisance (il accepte un canal sans titre, ni lien, ni description).

## Tâches

- [x] **1. Le module, généré et non écrit à la main.** `npx ks scaffold` ne peut pas tourner en cours de story (`assertRepositoryClean`, ADR 041) : appeler l'API exportée `scaffoldFiles(moduleId)` de `packages/cli/src/scaffold-files.ts`. Les 15 clés du contrat, vides s'il le faut. Inscription dans `config/features.ts` (annuaire **et** activés) et vérification que `config/profiles.ts` le classe.
- [x] **2. Le constructeur de flux trouve un toit.** Extraire la partie générique de `blog/src/domain/feed.ts` vers un paquet partagé, sans framework et sans lecture de disque ; `renderBlogFeed` en devient une enveloppe mince, pour que **les tests de s53 restent valides tels quels** — s'ils changent, c'est que l'extraction a changé le comportement. **ADR** sur la branche : quel paquet, et pourquoi pas `requires: ['blog']`.
- [x] **3. Une entrée est un fichier MDX, et un frontmatter invalide fait échouer le build.** Zod à la frontière, refus **nommant le fichier fautif** — c'est la forme que s29 a établie. Version, date, catégorie.
- [x] **4. Le tri sémantique, avec une fixture qui franchit le passage à deux chiffres.** `10.0` après `9.0`. Une fixture à un seul chiffre laisserait verte la mutation qui retire le tri — c'est le mode d'échec que s29 a rencontré sur son tri par date. Grouper par version, ordre chronologique inverse.
- [x] **5. Le flux du changelog.** Construit avec le primitif de la tâche 2. **Écrire ce que la mesure prouve, et rien de plus** : le flux servi est *analysé* par `@rowanmanning/feed-parser`, ce qui établit « analysable comme flux », pas « valide au sens d'un validateur ». La story dit « valide » ; le dépôt n'a pas de quoi le prouver. Reprendre la formulation que s53 a dû corriger en quatre endroits, plutôt que de la réintroduire.
- [x] **6. Traduction et plan de site.** Les entrées sont traduisibles, et référencées dans `sitemap.xml` par le mécanisme **contributif** de s53 — pas par un nom écrit dans le plan de site.
- [x] **7. Le pied de page, dérivé et non nommé.** Les sept fichiers de `apps/web/app` qui importent `consentFooterLinks` doivent appeler **une seule fonction dérivée du registre**, qui rend les liens de pied de page des modules activés. Un huitième module ne doit toucher aucun de ces sept fichiers. Un test le mesure : le balayage refuse un nom de module écrit en dur dans une page.
- [x] **8. Module coupé — les trois absences.** Pas de page (404), pas de flux, et **le lien disparaît du pied de page**. `pnpm test:minimal-profile` doit le tenir sans qu'on y nomme le changelog.
- [x] **9. Documentation.** `packages/modules/changelog/AGENTS.md`, et la ligne du paquet partagé si la tâche 2 en crée un.

## Sections de `docs/security.md` touchées

La page et le flux sont **publics** : ils passent par le répartiteur, donc `routeIsRateLimited` (ADR 050) s'y applique par dérivation — vérifier, ne pas déclarer. Zod à la frontière du frontmatter. Aucun secret dans le contenu servi.
