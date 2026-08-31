# packages/modules/marketing — règles locales

Le site public : **l'accueil sectionné et les mentions légales**. Premier module
du dépôt à livrer des écrans destinés à un visiteur sans compte, et premier
module optionnel dont la coupure se voit à la racine du site.

## Ce qu'il apporte, et ce qu'il n'apporte pas

| Ce qui | Où | Pourquoi |
|---|---|---|
| L'ordre et la nature des sections | `config/marketing.ts` | c'est ce que le propriétaire édite ; retirer une section est une ligne de moins |
| La **prose** | `src/messages/{fr,en}.json` | tout texte affiché vient d'un catalogue (s09), y compris celui des pages légales |
| La validation de cette configuration | `src/domain/marketing-config.ts` | une configuration est une frontière (`docs/security.md` §4) |
| Les clés qu'une configuration exige | `src/domain/message-keys.ts` | ces clés sont **composées**, donc invisibles au balayage statique de `tests/i18n.test.ts` |
| Le plan de site et la politique des robots | `src/domain/seo.ts` | fonctions pures : elles reçoivent les chemins et une façon de faire une URL |
| Les **pages** | `apps/web/app/page.tsx`, `apps/web/app/legal/[document]/page.tsx` | un `ModuleRoute` est monté sous `/api/modules/…` (ADR 017), ce n'est pas un écran |
| Le choix « module monté ou non » | `apps/web/lib/marketing.ts` | point de composition unique, sur le modèle de `lib/locale-routing.ts` |

## Deux points d'entrée, et pourquoi (ADR 024)

| Point d'entrée | Ce qu'il expose | Qui l'importe |
|---|---|---|
| `@repo/module-marketing` | le contrat, `domain/` et `application/` | `config/features.ts`, et donc `pnpm db:generate`, `pnpm ks`, le `typecheck` de `@repo/db` |
| `@repo/module-marketing/presentation` | la couche `presentation/` — du `.tsx` | `apps/web` seule |

Le barril principal n'exporte **jamais** de `.tsx`, ni directement ni par
réexport. Ce n'est pas un rangement : `config/features.ts` est lu par des outils
qui ne compilent pas de JSX, et un `export … from './presentation/…'` dans
`src/index.ts` fait échouer `pnpm typecheck` — sur `@repo/db`, avec
`error TS6142 … '--jsx' is not set`. C'est la règle de **tout module à
composants** ; l'ADR 024 la pose et dit ce qui a été rejeté.

Ce module ne déclare **ni table, ni migration, ni route** en s10, et son contrat
n'en est pas moins rempli au complet (ADR 007). La table des inscriptions
publiques et les messages de contact appartiennent à **s11** ; la limitation de
débit de ces formulaires à **s28**, qui énumère ses points d'entrée. Les
anticiper ici produirait un schéma que rien n'écrit.

## Imports autorisés

- `@repo/core` pour le contrat de module et la qualification des clés de
  traduction ;
- `@repo/ui` pour **tout** ce qui s'affiche, dans `src/presentation/`
  uniquement : c'est le design system, et la seule frontière avec le socle de
  composants. Un import de `@radix-ui/*` ici est refusé par `pnpm lint`
  (ADR 022) ;
- `zod` dans `src/domain/` : bibliothèque pure, explicitement admise dans le
  `domain` (`tooling/eslint/boundaries.ts`) ;
- `react` — déclaré en `peerDependencies`, c'est l'application qui fournit sa
  version — dans `src/presentation/` uniquement ;
- `@repo/typescript-config` et `@types/react` pour la compilation ;
- `vitest` dans les fichiers de test.

Pas de `next`, pas de `next-intl`, pas de `@repo/db` : ce module ne connaît ni
le routeur, ni la bibliothèque de traduction, ni la base. Il reçoit un
`MarketingIntl` — deux fonctions, `t` et `path` — et rend du balisage.

## Ne doit jamais contenir

- **de texte affiché écrit en dur**, quelle qu'en soit la forme. Tout passe par
  une clé de catalogue, y compris le nom accessible du pied de page.
  `tests/i18n.test.ts` balaie les `.tsx` de `packages/modules`, et un seul mot
  suffit à le faire rougir ;
- **de couleur Tailwind brute** (`bg-zinc-800`) : les tokens sémantiques, et
  eux seuls ;
- **de primitive de design system** : un besoin non couvert est un *design
  system gap* à signaler dans la story, jamais à combler ici. C'est pour cette
  raison que le pied de page est composé de `Separator` et de liens, et n'est
  pas un composant `Footer` maison ;
- **de condition sur l'identifiant d'un module**, ici ou dans le code appelant.
  L'état « module coupé » est une **donnée** : `EMPTY_MARKETING_SITE`, dont les
  trois listes sont vides ;
- **de destination externe dans une action de section.** Le schéma n'accepte
  qu'un chemin interne : une configuration qui poserait `https://…` sur un
  bouton de la page d'accueil serait une redirection ouverte à la main du
  premier fichier venu (`docs/security.md` §4) ;
- **de contenu inventé présenté comme un fait.** Les pages juridiques comme les
  témoignages livrés sont des **modèles à adapter**, et ils le disent dans leur
  propre corps — « Modèle à adapter » / « Template to adapt ». Livrer une
  politique de confidentialité qui a l'air complète, ou des avis clients qui ont
  l'air vrais, est plus dangereux que de ne rien livrer. `tests/marketing.test.ts`
  dérive l'ensemble surveillé de la configuration : sections légales et éléments
  d'une section de nature `testimonials`.

## Tests

- `src/application/marketing-site.test.ts` : les règles pures — validation de la
  configuration et chacun de ses refus, ordre des sections, chemins publics,
  clés de traduction exigées, plan de site, politique des robots. Aucune de ces
  règles ne se prouve ailleurs ;
- `tests/marketing.test.ts` à la racine : le **câblage** — registre avec et sans
  le module, écrans rendus dans leurs trois branches, catalogues complets, la
  canonique de chaque page légale langue par langue, le `robots.txt` confronté à
  **chaque écran du disque**, et la mesure « aucune requête base de données »,
  faite pendant le rendu réel des pages publiques et du shell (compteur posé sur
  les prototypes de `pg`, donc sur toute connexion du processus) ;
- `e2e/marketing.spec.ts` : ce qu'aucun test de nœud ne peut dire — le
  `sitemap.xml` et le `robots.txt` réellement servis, les balises Open Graph
  telles que le navigateur les reçoit, et les liens du pied de page suivis.
  Ses attentes sont **dérivées** de l'état du module, jamais recopiées : le
  fichier doit passer dans les deux configurations.
