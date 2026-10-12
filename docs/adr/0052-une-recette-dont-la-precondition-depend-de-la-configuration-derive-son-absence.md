# ADR 052 — Une recette dont la précondition dépend de la configuration dérive son absence au lieu de la sauter

- Status: accepted
- Date: 2026-09-04
- Scope: story s48-ci-verte

## Context

La CI joue **deux configurations** (`.github/workflows/ci.yml`, matrice
`modules: [tous, socle]`), et c'est délibéré : une garde qui ne s'exécute jamais
dans la configuration où elle mord est de la documentation.

Le critère 8 de s26 — « couper un module de plus ne demande aucune modification
du harnais » — se prouve en coupant un module **de plus** que le profil livré et
en vérifiant que le balayage grandit exactement de ce que ce module déclare. La
preuve a donc une précondition : il faut un module **coupable**, c'est-à-dire
hors socle, hors profil livré, requis par personne, déclarant à la fois une
route, une entrée de navigation et une table — sans les trois, les écarts
mesurés valent zéro et ne prouvent rien —, et **activé par la configuration**.

Le test refusait volontairement de nommer ce module : « écrire son nom ici
rendrait ce test faux au module suivant ». Mais un prédicat que le dépôt ne
satisfait qu'une fois est un nom déguisé. Mesuré à l'ouverture de s48, sur
l'annuaire réel, module par module : **un seul** module activé tient les sept
critères, et la branche « socle » de la CI le coupe. Sous cette branche,
`expect(extra).toBeDefined()` tombait — cinq commits de CI rouge, sans qu'aucune
régression n'existe.

La question posée n'est donc pas « comment rendre ce cas vert », mais **que doit
affirmer une recette quand sa précondition dépend de la configuration et que la
configuration ne la tient pas**.

## Decision

Le prédicat est **coupé en deux**, et l'absence est **dérivée** :

1. les critères qui ne dépendent que de l'annuaire (six, chacun **nommé**)
   définissent la **capacité** : « ce module serait coupable si la configuration
   l'activait ». C'est un invariant, affirmé sous les deux configurations —
   l'annuaire contient toujours au moins un module coupable, et le prédicat en
   écarte au moins un autre ;
2. le critère qui dépend de la configuration — « et elle l'active » — décide de
   la **branche**. Tenu, la preuve tourne, inchangée. Non tenu, un second cas
   affirme que **chaque module de l'annuaire** échoue sur au moins un critère
   **nommé**, et que le décompte des modules expliqués **égale** la taille de
   l'annuaire.

Aucun cas n'est sauté, aucun ne sort par un `return` anticipé, et le nombre de
cas exécutés ne baisse pas d'une configuration à l'autre. Les deux branches sont
en outre jouées **à chaque exécution** sur un annuaire d'essai, faute de quoi
celle que la configuration courante ne prend pas serait du code mort — la façon
même dont une branche d'absence devient un faux vert.

La règle généralise : **une recette dont la précondition dépend de la
configuration dérive l'absence de sa précondition, elle ne la saute pas.**

## Considered options

- **`it.skipIf(!extra)`, ou un `return` anticipé** — rejeté : la moitié « socle »
  de la matrice redevenait verte sans rien vérifier, et le rapport de Vitest
  aurait annoncé un cas sauté que personne ne lit. C'est le mode d'échec que
  `AGENTS.md` nomme (« a green mutation means the test is wrong ») et que la
  recette de s26 refuse déjà par ailleurs, en refusant un balayage vide et une
  part de cas sautés au-delà de 5 %.
- **Écrire l'identifiant du module dans le test** — rejeté : c'est exactement le
  défaut que le critère 8 existe pour attraper. Le test serait vert aujourd'hui
  et faux au module suivant, au moment précis où plus personne ne regarde.
- **Relâcher le prédicat** (par exemple exiger route *ou* navigation *ou* table)
  — rejeté deux fois : les écarts mesurés par la preuve vaudraient zéro dans les
  catégories non déclarées, donc la preuve cesserait de prouver ; et le problème
  ne serait que déplacé, un dépôt réduit à un seul module qualifiant le
  retrouverait tel quel.
- **Ajouter une entrée de navigation à un module pour créer un second candidat**
  — rejeté : ce serait écrire le produit pour la mesure. Si le dépôt doit gagner
  une entrée de navigation, c'est une décision de produit, prise pour ses
  utilisateurs.
- **Ne jouer qu'une configuration en CI** — rejeté : c'est renoncer à la moitié
  de ce que la matrice existe pour éprouver, et trois revues (s10, s15, s11) ont
  déjà trouvé des gardes qui ne mordent que dans l'état que la CI ne jouait pas.

## Consequences

Ce qui devient plus facile : couper un module de plus dans la configuration de
la CI ne casse plus le harnais ; il change la branche jouée, et l'absence de
candidat est expliquée module par module au lieu de tomber.

Ce qui devient plus difficile : la preuve du critère 8 ne tourne réellement que
sous la configuration qui active un module coupable — sous l'autre, c'est la
**capacité** qui est affirmée, pas la généricité elle-même. La matrice de CI
reste donc nécessaire : une CI qui ne jouerait que « socle » n'exécuterait plus
jamais la preuve.

Ce qu'il faut surveiller : l'invariant d'annuaire est le seul filet. S'il
tombait — un dépôt dont plus aucun module ne déclare route, navigation et table
hors socle et hors profil —, la branche « explication » resterait verte en
n'expliquant qu'une capitulation. C'est pourquoi il est affirmé, et pourquoi sa
mutation (retirer l'entrée de navigation des modules coupables) doit rougir.
