# packages/modules/marketing — règles locales

Le site public : **l'accueil sectionné, les mentions légales, et depuis s11 les
deux formulaires ouverts à tout venant**. Premier module du dépôt à livrer des
écrans destinés à un visiteur sans compte, premier module optionnel dont la
coupure se voit à la racine du site, et premier à recevoir des données de
quelqu'un qui n'a pas de compte.

## Ce qu'il apporte, et ce qu'il n'apporte pas

| Ce qui | Où | Pourquoi |
|---|---|---|
| L'ordre et la nature des sections | `config/marketing.ts` | c'est ce que le propriétaire édite ; retirer une section est une ligne de moins |
| **L'adresse qui reçoit les messages de contact** | `config/marketing.ts`, bloc `forms` | piège nommé par s11 : une constante serait la même dans tous les projets générés |
| **La source d'inscription et les seuils de débit** | idem | la source distingue newsletter et liste d'attente ; les seuils sont ceux que `docs/security.md` §7 veut « configurables » |
| La **prose** | `src/messages/{fr,en}.json` | tout texte affiché vient d'un catalogue (s09), y compris celui des pages légales et des formulaires |
| La validation de cette configuration | `src/domain/marketing-config.ts` | une configuration est une frontière (`docs/security.md` §4) |
| La validation d'une **soumission** | `src/domain/public-forms.ts` | un corps de requête est une frontière, au même titre |
| Les clés qu'une configuration exige | `src/domain/message-keys.ts` | ces clés sont **composées**, donc invisibles au balayage statique de `tests/i18n.test.ts` |
| Le plan de site et la politique des robots | `packages/core/src/syndication.ts` | **montées dans le socle en s53** (ADR 054) : `app/robots.ts` et `app/sitemap.ts` ne doivent connaître aucun module par son nom, et ces fonctions n'ont jamais rien eu de marketing |
| Ce que ce module **donne à indexer** | `src/infrastructure/marketing-content.ts` | la quinzième clé du contrat : ses chemins publics, fournis par le point de composition qui valide `config/marketing.ts` |
| Les **règles** des deux formulaires | `src/application/public-forms.ts` | ce que la route rend, ce qui est écrit, ce qui est envoyé |
| Les **pages** | `apps/web/app/page.tsx`, `apps/web/app/legal/[document]/page.tsx`, `apps/web/app/contact/page.tsx` | un `ModuleRoute` est monté sous `/api/modules/…` (ADR 017), ce n'est pas un écran |
| Le **formulaire** interactif | `apps/web/app/public-form.tsx` | il appelle `fetch`, ce qu'un module n'a pas le droit de faire — voir plus bas |
| Le choix « module monté ou non » | `apps/web/lib/marketing.ts` | point de composition unique, sur le modèle de `lib/locale-routing.ts` |
| Le **câblage** du service (base, mailer, adresse d'un compte) | `apps/web/lib/module-services.ts` | il importe `lib/auth`, donc `next/headers` : le mettre dans `lib/marketing.ts` casse le chargement des parcours, qui importent ce fichier hors de Next (mesuré) |

## Deux points d'entrée, et pourquoi (ADR 024)

| Point d'entrée | Ce qu'il expose | Qui l'importe |
|---|---|---|
| `@repo/module-marketing` | le contrat, `domain/`, `application/`, `infrastructure/` et les **routes** | `config/features.ts`, et donc `pnpm db:generate`, `pnpm ks`, le `typecheck` de `@repo/db` |
| `@repo/module-marketing/presentation` | la couche `presentation/` en `.tsx` | `apps/web` seule |

Le barril principal n'exporte **jamais** de `.tsx`, ni directement ni par
réexport. Ce n'est pas un rangement : `config/features.ts` est lu par des outils
qui ne compilent pas de JSX, et un `export … from './presentation/…'` dans
`src/index.ts` fait échouer `pnpm typecheck` — sur `@repo/db`, avec
`error TS6142 … '--jsx' is not set`. C'est la règle de **tout module à
composants** ; l'ADR 024 la pose et dit ce qui a été rejeté.
`presentation/public-form-routes.ts` est du `.ts` : il sort par le barril
principal, comme `organization-routes.ts` du module voisin.

## Les deux formulaires publics (s11)

**Trois tables, deux routes, deux emails.**

| Table | Ce qu'elle porte |
|---|---|
| `public_subscription` | une adresse, sa **source**, sa langue. Unicité **en base** sur `(source, email)` : c'est elle, et pas une vérification préalable, qui rend une seconde soumission sans effet (`docs/reliability.md` §1). La table est **partagée** avec la liste d'attente de s42, qui déclarera sa propre source — un second modèle d'inscription est interdit par la story |
| `contact_message` | le message reçu, **écrit avant d'être envoyé**. `delivered_at` vide = reçu, pas parti : c'est la trace qui permet de rattraper ce que le fournisseur n'a pas pris. Catégorie déclarée au contrat, donc exportée et effacée |
| `public_form_throttle` | **abandonnée depuis s28, jamais supprimée.** Elle portait le compteur de débit ; ce module compte désormais à travers le port partagé (`@repo/ports`, ADR 050) et **n'écrit plus une ligne ici**. La table reste déclarée parce que `docs/reliability.md` impose de cesser d'écrire avant de supprimer, et que la version encore en ligne l'écrit pendant une bascule. Sa suppression est une story ultérieure — `tests/rate-limiting.test.ts` refuse à la fois qu'on la réécrive et qu'on la supprime ici |

| Route | Ce qu'elle rend |
|---|---|
| `POST /api/modules/marketing/contact` | 200 accepté, **400 avec le champ nommé**, 429 au-delà du seuil **de l'appelant**, 502 si l'email n'est pas parti — le message reste alors en base |
| `POST /api/modules/marketing/newsletter` | **200, toujours** — adresse nouvelle, déjà inscrite ou malformée : même statut, même corps |

Cette asymétrie est la règle la plus importante du module et elle se défend :
le contact n'a rien à énumérer, son destinataire est fixe et connu. La
newsletter, elle, dirait qui est déjà dans la liste en distinguant ses cas
(`docs/security.md` §7) — exactement comme un écran de connexion qui distingue
« compte inconnu » de « mot de passe invalide ». C'est pour la même raison que
l'email de confirmation part **hors du temps de réponse** : une inscription
nouvelle en envoie un, un doublon non, et la latence trahirait le cas.

**Le piège à robots est silencieux.** Champ rempli ⇒ la réponse d'une
soumission acceptée, et **rien** n'est écrit ni envoyé. Répondre 400 en nommant
le champ apprendrait au robot lequel laisser vide. Le refus ne se mesure donc
que par l'absence d'effet — c'est ce que font
`application/public-forms.test.ts` et `e2e/public-forms.spec.ts`.

**Le champ piège est masqué par une classe de la feuille de style**, jamais par
un attribut `style` : `style-src-attr` est la seule directive de la politique de
sécurité du contenu qui ignore les nonces (`packages/ui/AGENTS.md`), et un style
en ligne serait refusé en production.

### La limitation de débit a convergé en s28 — la règle reste, le compteur est parti

Ce module a porté le premier compteur de débit du dépôt (s11), parce que ses deux
routes étaient les premiers points d'entrée publics. **s28 l'a absorbé** (ADR 050) :

- le **compteur** est le port partagé, et `public_form_throttle` n'est plus
  écrite. `infrastructure/shared-submission-throttle.ts` branche l'un sur
  l'autre ; le point de composition de l'application injecte le limiteur ;
- le **répartiteur** limite en plus ces deux routes d'office, par la politique
  `publicForm` de `config/security.ts` — toute route publique du registre l'est,
  sans qu'aucune ne soit nommée ;
- la **règle de ce module reste ici**, et c'est pour cela qu'elle n'a pas été
  supprimée : ses deux seaux ne portent pas le même verdict, et celui du
  formulaire entier **dégrade** — il suspend l'envoi sortant sans refuser la
  soumission (constat F2 de la revue de s11). Le répartiteur ne connaît que
  « autorisé » et « 429 » : il ne sait pas exprimer une dégradation.

**Ce qu'il ne faut pas faire ici** : supprimer `public_form_throttle` (voir le
tableau ci-dessus), ni réintroduire un compteur local — le port est le seul.

**Limite connue, et non refermée ici** : l'identifiant d'appelant vient de
`x-forwarded-for`, que n'importe qui peut écrire hors d'un proxy de confiance.
C'est pourquoi il y a **deux** seaux, et c'est aussi pourquoi ils ne portent pas
le même verdict.

| Seau | Dépassé, il… | Pourquoi |
|---|---|---|
| par **appelant** (`<forme>:client:<condensat>`) | **refuse** — 429 | un identifiant falsifié ne nuit qu'à lui-même ; le message rendu dit « depuis cette connexion », ce qui est vrai |
| par **formulaire** (`<forme>:all`) | **dégrade** — la soumission passe, l'**envoi sortant** est suspendu | s'il refusait, l'en-tête falsifiable deviendrait un levier : quelques centaines de requêtes fermeraient les deux formulaires à tous les visiteurs pendant la fenêtre. C'est le constat F2 de la revue de s11, et c'était le cas dans la première écriture |

Deux conséquences à ne pas défaire :

- une requête **déjà refusée n'écrit plus rien** : le seau du formulaire n'est
  consulté qu'après que celui de l'appelant a laissé passer. Les deux étaient
  incrémentés ensemble, si bien qu'un 429 faisait quand même grandir la table
  (constat F1) ;
- les lignes d'une fenêtre **close** sont effacées (`SubmissionThrottle.sweep`),
  à la première soumission de la fenêtre suivante. La table ne porte donc jamais
  plus que ce qu'une fenêtre a vu. Le fichier d'infrastructure a affirmé le
  contraire — « la table ne grandit pas avec le temps » — alors que 500
  identifiants distincts donnaient 500 lignes définitives ; l'effacement est
  désormais **exécuté** dans `tests/marketing.test.ts`, pas déclaré.

**Ce que la dégradation coûte, et qu'il ne faut pas taire.** Le seau du
formulaire refusait ; il bornait donc aussi, incidemment, le nombre de lignes
qu'une vague de soumissions pouvait écrire — 200 par fenêtre. En dégradant, il ne
borne plus que les **envois**. Sous un `x-forwarded-for` qui tourne, la
croissance de `public_subscription` et de `contact_message` n'est bornée que par
`maxPerClient` **par identifiant**, c'est-à-dire par rien tant que l'identifiant
est falsifiable. C'est un échange, et il est assumé : l'ancien comportement
convertissait un risque de stockage en **certitude d'indisponibilité** pour tous
les visiteurs, et c'est ce que la revue a refusé. La fermeture réelle est un
identifiant infalsifiable — un nombre de sauts de proxy configuré —, qui demande
une adresse de pair que la pile n'offre pas — et que s28 n'a pas fermée non
plus : elle a répondu au même risque par un **second seau, par compte visé**,
qui ne dépend d'aucun en-tête. Le compteur, lui, reste borné : ses lignes ne
survivent pas à leur fenêtre.

**Écart de temps de réponse résiduel, mesuré et non exploitable.** La revue a
mesuré, serveur de production chaud, 40 tirs entrelacés : adresse nouvelle
5,46 ms de médiane, adresse déjà inscrite 5,09 ms, adresse malformée 3,95 ms.
La réponse n'**attend** pas l'envoi — c'est prouvé par mutation —, mais le
préfixe synchrone de `mailer.send` (le rendu du gabarit) reste sur le chemin. Les
distributions se recouvrent largement et la gigue réseau est d'un ordre de
grandeur supérieur : l'écart ne constitue pas une oracle d'inscription
exploitable. L'écart malformée/valide n'en est pas une non plus — l'appelant sait
déjà si son adresse est bien formée. C'est écrit ici pour que la prochaine
mesure sache ce qui a déjà été mesuré, et sur quoi.

## Le pied de page accepte des liens qu'il ne connaît pas (s36)

`MarketingFooter` porte un `extraLinks`, que les trois vues du module
(`MarketingHome`, `ContactView`, `LegalDocumentView`) reçoivent en `footerLinks`
et transmettent. Les liens arrivent **déjà traduits** et portent un chemin
interne, comme ceux du module.

La raison est le finding F57 de la revue des stories : le socle a des pages que
le site public doit annoncer sans que ce module les connaisse — l'écran de
préférences de cookies de s36 est la première. L'inverse, les déclarer dans
`config/marketing.ts`, ferait **disparaître le point d'accès au consentement
avec le site public**, c'est-à-dire exactement la non-conformité que s36 existe
pour empêcher.

Ce module ne sait donc pas ce qu'est le consentement : il affiche un lien qu'on
lui donne. Le point d'accès qui ne dépend de rien vit ailleurs, dans les
paramètres de compte de l'application.

## Ce qui n'est pas livré, et pourquoi

- **le lien de désinscription** dans l'email de confirmation : aucune route
  livrée ne le servirait, et un lien mort dans un email est pire qu'un lien
  absent. Le texte dit quoi faire à la place ;
- **un captcha** : `docs/security.md` §7 le veut « activable », et
  `config/security.ts` porte depuis s28 les seuils et le drapeau de captcha —
  coupé, et sans fournisseur branché.

## Imports autorisés

- `@repo/core` pour le contrat de module, la qualification des clés de
  traduction, le préfixe de montage des routes et la résolution de locale ;
- `@repo/ports` pour le port `Mailer` — dans `application/` et
  `infrastructure/` uniquement. C'est une **interface**, pas un SDK : le module
  ne sait pas qui envoie ses emails ;
- `drizzle-orm` et `drizzle-orm/pg-core` dans `schema.ts` et
  `infrastructure/` : les tables du module et ses repositories. La **connexion**
  reste injectée — ce package n'importe jamais `@repo/db` (ADR 020) ;
- `@repo/ui` pour **tout** ce qui s'affiche, dans `src/presentation/`
  uniquement : c'est le design system, et la seule frontière avec le socle de
  composants. Un import de `@radix-ui/*` ici est refusé par `pnpm lint`
  (ADR 022) ;
- `zod` dans `src/domain/` : bibliothèque pure, explicitement admise dans le
  `domain` (`tooling/eslint/boundaries.ts`) ;
- `node:crypto` dans `infrastructure/` : le condensat d'un seau et
  l'identifiant d'une inscription ;
- `react` — déclaré en `peerDependencies`, c'est l'application qui fournit sa
  version — dans `src/presentation/` uniquement ;
- `@repo/typescript-config` et `@types/react` pour la compilation ;
- `vitest` dans les fichiers de test.

Pas de `next`, pas de `next-intl`, pas de `@repo/db` : ce module ne connaît ni
le routeur, ni la bibliothèque de traduction, ni la base. Il reçoit un
`MarketingIntl` — deux fonctions, `t` et `path` — et rend du balisage.

**Pas de `fetch` non plus**, et c'est une règle de lint : tout appel réseau
sortant d'un module passe par une porte bornée (`docs/reliability.md` §3). C'est
pour cela que le formulaire interactif de s11 vit dans `apps/web`, comme
`auth-form.tsx` depuis s07 : il appelle **notre propre route** depuis un
navigateur, un cas que la règle ne visait pas, et élargir une garde de sécurité
pour un cas particulier est le geste que ce dépôt refuse. `MarketingHome` et
`ContactView` reçoivent donc le formulaire en `ReactNode` : le module décide
**où** il s'affiche, l'application le fournit.

## Ne doit jamais contenir

- **de texte affiché écrit en dur**, quelle qu'en soit la forme. Tout passe par
  une clé de catalogue, y compris le nom accessible du pied de page.
  `tests/i18n.test.ts` balaie les `.tsx` de `packages/modules`, et un seul mot
  suffit à le faire rougir — **y compris un littéral d'un mot écrit entre
  accolades dans des enfants JSX** (`{x === 'textarea' ? … : …}`), ce qui est
  exactement la forme sous laquelle un « Fermer » s'est glissé dans
  `packages/ui`. La comparaison se pose hors du JSX ;
- **de couleur Tailwind brute** (`bg-zinc-800`) : les tokens sémantiques, et
  eux seuls ;
- **de primitive de design system** : un besoin non couvert est un *design
  system gap* à signaler dans la story, jamais à combler ici. C'est pour cette
  raison que le pied de page est composé de `Separator` et de liens, et que les
  formulaires composent `Label`, `Input`, `Textarea` et `Alert` au lieu d'un
  composant `Form` maison — ce dernier est à l'inventaire du design system et
  **n'existe pas** ;
- **de condition sur l'identifiant d'un module**, ici ou dans le code appelant.
  L'état « module coupé » est une **donnée** : `EMPTY_MARKETING_SITE`, dont les
  trois listes sont vides et dont `forms` vaut `null` ;
- **de destination externe dans une action de section.** Le schéma n'accepte
  qu'un chemin interne : une configuration qui poserait `https://…` sur un
  bouton de la page d'accueil serait une redirection ouverte à la main du
  premier fichier venu (`docs/security.md` §4) ;
- **de donnée de visiteur dans le sujet d'un email.** `@repo/emails` interpole
  le sujet avec la **même** fonction que le corps, et elle n'échappe rien : le
  sujet est un champ d'en-tête. Les sujets déclarés ne portent donc aucun
  marqueur, et `tests/marketing.test.ts` le vérifie sur chaque template et
  chaque locale ;
- **de contenu inventé présenté comme un fait.** Les pages juridiques comme les
  témoignages livrés sont des **modèles à adapter**, et ils le disent dans leur
  propre corps — « Modèle à adapter » / « Template to adapt ». Livrer une
  politique de confidentialité qui a l'air complète, ou des avis clients qui ont
  l'air vrais, est plus dangereux que de ne rien livrer. `tests/marketing.test.ts`
  dérive l'ensemble surveillé de la configuration : sections légales et éléments
  d'une section de nature `testimonials`.

## Tests

- `src/application/marketing-site.test.ts` : les règles pures du **site** —
  validation de la configuration et chacun de ses refus, ordre des sections,
  chemins publics, clés de traduction exigées, plan de site, politique des
  robots ;
- `src/application/public-forms.test.ts` : les règles pures des **formulaires** —
  ce qu'une soumission a le droit de porter, le piège, les seuils et les
  fenêtres, et les cas d'usage sur doublures en mémoire. Chaque refus y est
  éprouvé **et** l'absence d'effet avec lui : un refus qui écrit quand même
  n'est pas un refus ;
- `tests/marketing.test.ts` à la racine : le **câblage** — registre avec et sans
  le module, écrans rendus dans leurs trois branches, catalogues complets, la
  canonique de chaque page légale langue par langue, le `robots.txt` confronté à
  **chaque écran du disque**, la mesure « aucune requête base de données »
  pendant le rendu réel des pages publiques, et depuis s11 : les **tables sur
  une base réelle** (absentes module coupé, présentes module activé, migration
  rejouée sans effet), la concurrence de deux inscriptions simultanées, le
  compteur de débit et **l'effacement des fenêtres closes, exécuté sur 500
  seaux**, et les routes servies par le répartiteur. Tout cela se passe dans un
  **schéma dédié**, créé puis détruit : la première écriture supprimait les
  tables du module dans `public`, sur la base de développement partagée, et une
  exécution interrompue laissait la base sans elles (constat F9) ;
- `e2e/public-forms.spec.ts` : ce qu'aucun test de nœud ne peut dire — le
  formulaire réellement servi, soumis par un navigateur qui hydrate, et l'email
  réellement écrit sur disque par le mailer de l'application. Chaque parcours y
  pose son propre `x-forwarded-for` : le seau de débit est en base et dure dix
  minutes, deux exécutions rapprochées se marcheraient sinon dessus ;
- `e2e/marketing.spec.ts` : le `sitemap.xml` et le `robots.txt` réellement
  servis, les balises Open Graph telles que le navigateur les reçoit, et les
  liens du pied de page suivis. Ses attentes sont **dérivées** de l'état du
  module, jamais recopiées : le fichier doit passer dans les deux
  configurations.
