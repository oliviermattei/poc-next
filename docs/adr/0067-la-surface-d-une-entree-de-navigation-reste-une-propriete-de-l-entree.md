# ADR 067 — La surface d'une entrée de navigation reste une propriété de l'entrée, y compris à la troisième

- Status: accepted
- Date: 2026-09-06
- Scope: story s37b2-back-office-lecture

## Context

L'ADR 066, accepté l'avant-veille, a ouvert `NavigationSurface` à deux valeurs —
`app` (la barre latérale du produit) et `footer` (le pied de page public) — et
il a écrit **la question à poser au moment où une troisième arriverait** :

> Une **troisième** surface […] c'est aussi le moment où il faudra se demander si
> la surface est encore une propriété de l'entrée ou une propriété de l'écran qui
> la rend. Tant qu'il y en a deux, elle appartient à l'entrée.

Cette story amène cette troisième valeur. Le back-office de s37b2 porte sa propre
navigation : « Comptes », déclarée par le module `admin`, et « Organisations »,
déclarée par le module `organizations`. La seconde doit **disparaître avec son
module** — c'est le critère de modularité que `pnpm test:minimal-profile`
mesure. Écrite en dur dans un écran de `apps/web`, elle y aurait nommé
`organizations`, puis le module suivant au même endroit : le défaut exact que
l'ADR 066 a corrigé pour le pied de page.

Le diff de la story a ajouté la valeur `admin` à l'union, avec un commentaire
argumentant par analogie avec `footer` — mais **sans répondre à la question**, et
sans ADR. C'est un changement du contrat de `packages/core`, dont le précédent du
dépôt est un ADR (024 pour le second point d'entrée, 054 pour `publicUrls`, 066
pour la surface elle-même). La revue de s37b2 l'a relevé comme constat majeur
F1, et la revue de s31 avait fait le même constat une story plus tôt.

## Decision

**La surface reste une propriété de l'entrée.** `NavigationSurface` devient
`'app' | 'footer' | 'admin'`, `visibleNavigation(registry, session, 'admin')`
la lit comme les deux autres, et `apps/web/lib/back-office.ts` en dérive la
navigation des quatre écrans du back-office. Aucun identifiant de module n'est
écrit dans `apps/web` pour cela.

**La réponse à la question de l'ADR 066, et son critère.** Une surface reste une
propriété de l'entrée tant qu'elle répond à *« où ce lien a-t-il un sens ? »* —
une question que seul le module qui possède le lien peut trancher. Elle
deviendrait une propriété de l'écran le jour où elle répondrait à *« quels liens
cet écran veut-il montrer ? »* — c'est-à-dire le jour où **un même lien devrait
paraître sur deux surfaces**, ou bien où un écran voudrait choisir un
sous-ensemble d'entrées selon autre chose que leur surface. Ni l'un ni l'autre
n'est le cas aujourd'hui : les trois surfaces sont disjointes par construction —
`visibleNavigation` compare `navigationSurfaceOf(entry)` à une seule surface, et
le champ ne porte qu'une valeur —, si bien qu'aucune entrée ne peut en servir
deux. Le nombre d'entrées livrées n'est écrit nulle part ici : il se dérive du
registre, et un nombre recopié à côté du code vieillit.

Ce critère est ce qui manquait à l'ADR 066, qui bornait sa règle par un
**compte** (« tant qu'il y en a deux »). Un compte se périme à la première
addition — celle-ci —, alors qu'un critère survit : la quatrième surface se
jugera sur le recouvrement, pas sur son rang.

**Ce que cette décision ne change pas.** Le champ reste facultatif, avec `'app'`
pour défaut appliqué une seule fois par `navigationSurfaceOf` (ADR 066) : aucun
module déjà écrit n'a été rouvert. Les surfaces restent disjointes. Et la
`protection` d'une entrée `admin` reste déclarée comme partout, bien que la seule
surface qui la lise soit servie par des écrans que la garde de superadmin protège
déjà : un niveau de protection n'a pas de défaut sûr, et une entrée qui hériterait
du silence serait ouverte par omission.

## Considered options

- **Une troisième valeur de `NavigationSurface`** — **retenu**. Le coût est une
  ligne d'union, et le mécanisme est déjà éprouvé par `footer` : le registre
  n'agrège que les modules activés, donc l'entrée d'`organizations` paraît et
  disparaît sans qu'aucune condition ne soit écrite. Ce qui manquait n'était pas
  le code, c'était la décision.
- **Faire de la surface une propriété de l'écran** — un écran déclarerait les
  entrées qu'il veut, par exemple une liste d'identifiants de modules ou un
  prédicat. Rejeté : c'est précisément le défaut que l'ADR 066 a supprimé.
  L'écran du back-office aurait nommé `organizations`, et le module suivant
  l'aurait fait nommer au même endroit ; le coût d'un module optionnel doit être
  nul pour les écrans, et `pnpm test:minimal-profile` mesure cette promesse.
- **Un champ booléen `backOffice: true`** — rejeté, et pour la raison qui a déjà
  écarté une seizième clé de contrat en s31 : une surface par champ ne compose
  pas. Deux booléens autoriseraient `footer + backOffice`, un état que rien ne
  sait rendre, là où une union ferme la porte à la compilation. Et la quatrième
  surface demanderait un troisième booléen, donc huit combinaisons dont sept sans
  écran.
- **Une clé `adminNavigation` dans le contrat de module** — rejeté : chaque clé
  du contrat est obligatoire, donc toute clé ajoutée rouvre **tous** les modules
  déjà écrits. Elle aurait par ailleurs dupliqué `protection`, `order` et
  `labelKey` pour redire ce que `navigation` dit déjà. C'est mot pour mot
  l'option que l'ADR 066 a rejetée pour le pied de page.
- **Dériver la navigation du back-office des routes que le module `admin` sert**
  — rejeté : les routes du module sont des `POST` d'action (bannir, révoquer,
  emprunter), pas des écrans. Aucune ne correspond à une page du back-office, et
  celle des organisations est servie par un **autre** module. La correspondance
  n'existe pas ; la fabriquer serait une seconde source de vérité.
- **Ne rien décider et laisser le commentaire de `packages/core/src/module.ts`
  tenir lieu de raison** — rejeté, c'est l'état que la revue a refusé. Un
  commentaire n'énumère pas les options écartées, ne se relit pas au moment
  d'ajouter la quatrième valeur, et ne dit pas ce qui ferait changer d'avis.

## Consequences

**Ce qui devient plus facile.** Un module qui veut une entrée de back-office la
déclare là où il déclare déjà ses autres entrées, et elle disparaît avec lui.
`tests/admin.test.ts` le mesure dans les deux sens — l'entrée d'un module activé
paraît, le module coupé ne contribue plus rien — et vérifie de surcroît qu'aucune
entrée `admin:*` ne fuit dans la barre latérale du produit.

**Ce qui devient plus difficile.** Une union à trois valeurs est une union qu'on
lit moins vite qu'un booléen, et le défaut facultatif reste ce qu'il était : un
module qui veut une entrée de back-office et oublie `surface` obtient une entrée
de barre latérale. C'est visible à l'écran, et le test de la barre latérale
l'attrape pour les modules livrés — pas pour un module futur, dont seule
l'entrée dérivée du registre le dirait.

**Ce qu'il faut surveiller.** La **quatrième** surface se juge désormais sur le
critère ci-dessus, pas sur son rang : si un même lien doit paraître sur deux
surfaces, ou si un écran veut choisir ses entrées autrement que par leur surface,
alors la surface a cessé d'être une propriété de l'entrée et cet ADR est à
remplacer. Tant que les surfaces restent disjointes, une valeur de plus est une
ligne de plus.
