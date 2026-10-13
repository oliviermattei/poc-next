# ADR 053 — Le MDX est compilé au build par le bundler de Next, jamais évalué à l'exécution

- Status: accepted
- Date: 2026-09-04

Le blog, la documentation produit et les nouveautés lisent leur contenu dans des fichiers MDX (`content/blog`, `content/docs`, `content/changelog`), servis par `apps/web`. Deux contraintes du dépôt éliminent des solutions avant toute comparaison : la politique de sécurité du contenu n'accorde `'unsafe-eval'` qu'en développement (`apps/web/lib/security-headers.ts`), et `dangerouslySetInnerHTML` n'est employé nulle part.

**Le MDX est compilé en composants React par le bundler de Next, à la construction**, via `@next/mdx` et `@mdx-js/loader`, avec `remark-frontmatter`. Le corps d'une page est un module JavaScript du bundle serveur, pas une chaîne : aucune évaluation à la requête. Le frontmatter est lu à part, par le système de fichiers, validé par Zod, et une erreur nomme le fichier fautif — la liste existe sans charger chaque corps. Les corps sont atteints par un `import()` à segments variables, dont Turbopack fait un contexte : un fichier déposé apparaît après build, sans index à tenir. Le corps passe par une table de composants MDX qui n'utilise que les rôles et jetons du design system (l'échelle de prose, `packages/ui/AGENTS.md`).

## Considered options

- **`next-mdx-remote`, et tout `evaluate` / `run` de `@mdx-js/mdx`** — rejeté : ils construisent le composant par `new Function` ; une évaluation à l'exécution, qui demanderait `'unsafe-eval'` le jour où le même pipeline sert un rendu client.
- **`velite`** — rejeté : sa sortie est soit du HTML en chaîne (`dangerouslySetInnerHTML`), soit du code pour `new Function`.
- **`contentlayer`** — rejeté : non maintenu, et il génère des artefacts à committer, donc un index à tenir.
- **`fumadocs-mdx` pour les contenus servis par `apps/web`** — rejeté : il compile bien au build, mais apporte son routeur, sa recherche et sa mise en page, une seconde interface par-dessus `packages/ui` dans le produit même. Ce rejet ne vaut que pour le produit : le Guide, site séparé qui ne s'affiche à aucun client, est construit avec Fumadocs (ADR 083).
- **Un pipeline Markdown → HTML (`remark` + `rehype-stringify`)** — rejeté : il produit une chaîne, donc exige `dangerouslySetInnerHTML`.
- **`@tailwindcss/typography`** — rejeté : il apporte sa propre échelle typographique, qui remplacerait localement celle du design system.

## Consequences

- Un contenu n'existe qu'après un build : déposer un `.mdx` dans un conteneur en marche ne le sert pas. C'est aussi ce qui garantit qu'aucune ligne de contenu n'est évaluée à la requête.
- `apps/web/next.config.ts` déclare `outputFileTracingIncludes` pour les dossiers de contenu, mais ce n'est pas ce qui les embarque aujourd'hui : `resolve(process.cwd(), …)` dans `apps/web/lib/blog.ts`, `docs.ts` et `changelog.ts` fait tracer le projet entier. La déclaration est une assurance dont l'effet est masqué, qu'aucun test ne surveille ; resserrer ce traçage sans garde sur la sortie autonome livrerait une image sans contenu.
