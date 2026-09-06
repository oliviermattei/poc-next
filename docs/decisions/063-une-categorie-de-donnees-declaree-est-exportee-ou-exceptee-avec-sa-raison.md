# ADR 063 — Une catégorie de données déclarée est exportée, ou exceptée avec sa raison

- Status: accepted
- Date: 2026-09-06
- Scope: story s35-data-export

## Context

Le contrat de module porte trois clés qui parlent des mêmes données :
`dataCategories` **liste** ce que le module détient, `purge` **efface**, `export`
**restitue**. **Rien ne vérifiait que les trois s'accordent.** Un module peut
déclarer `dataCategories: ['x']`, poser une politique de rétention, purger pour
de bon — et rendre `export: async () => ({})`. Le compilateur l'accepte, le
registre l'accepte, la revue le lit comme une déclaration complète.

Ce n'est pas hypothétique : la recherche de s35 l'a prédit sur `admin` avant
même que s34 ne fusionne, et la fusion l'a livré tel quel — `dataCategories:
['grant-authorship']`, `retention: { 'grant-authorship': 'anonymize' }`, une
purge réelle, et un export vide. Le module avait **raison** de le faire, et la
raison était écrite en commentaire. Ce qui manquait n'était pas la décision :
c'était le dispositif qui force à la prendre, et qui la fait rougir quand elle
n'est pas prise.

C'est la forme exacte du défaut que ce dépôt paie en boucle : une garantie que
personne ne peut vérifier est lue comme vérifiée par l'agent suivant.

## Decision

**Chaque catégorie de données déclarée par un module activé est soit produite
par l'export, soit nommée dans une table d'exceptions avec une raison écrite.
Aucune troisième issue.**

Le garde est `auditDataCategoryCoverage` (`@repo/core`). Il rend trois constats :

- `not-exported` — un module déclare des catégories non exceptées et son export
  ne rend **aucune** clé ;
- `unexplained-exception` — une exception dont la raison est vide : une exception
  tacite n'en est pas une ;
- `stale-exception` — une exception qui ne correspond plus à aucune catégorie
  déclarée : elle a vieilli et doit être retirée.

**La commande qui échoue est `pnpm test`**, en nommant le module et la
catégorie (`tests/data-export.test.ts`).

**Ce que le garde mesure, et ce qu'il ne mesure pas** — la distinction décide de
ce qu'on a le droit d'en conclure :

- il ne compare **pas** les noms des clés d'une charge utile aux noms des
  catégories. `billing` déclare `subscription` et rend `subscriptions`,
  `marketing` déclare `contact-message` et rend `messages` : une correspondance
  par le nom serait une couverture par sous-chaîne, c'est-à-dire une illusion ;
- il travaille **par module**, pas par catégorie : un module qui déclare quatre
  catégories et n'en rend qu'une passe. C'est une couverture grossière, et elle
  est assumée — ce qu'elle attrape est le cas « je dis détenir des données
  personnelles et je n'en rends aucune », qui est le seul mesurable sans une
  table de correspondance écrite à la main, laquelle vieillirait à côté du code ;
- il ne voit **que les catégories déclarées**. Une donnée personnelle qu'aucune
  catégorie ne nomme lui est invisible. C'est le cas du **rôle** de
  `admin_platform_role` : il part par cascade, donc s34 ne lui a donné aucune
  catégorie, donc un superadmin qui exporte ses données n'y lit pas qu'il l'est.
  Le garde ne le dira jamais.

**La table d'exceptions vit dans `tests/data-export.test.ts`**, pas dans une
seizième clé du contrat. Elle porte aujourd'hui une entrée, `admin` /
`grant-authorship`, avec sa raison : la catégorie désigne
`admin_platform_role.granted_by` — l'empreinte de l'auteur d'une promotion,
portée par la ligne **d'un tiers**. L'exporter à l'auteur lui remettrait « voici
les rôles que vous avez attribués à ces personnes-là », c'est-à-dire des
identifiants de comptes qui ne sont pas les siens ; l'exporter au bénéficiaire ne
lui apprendrait rien de lui-même. C'est la lecture qui a fait choisir `anonymize`
plutôt que `erase` en s34 : ce qui part est le lien, pas la donnée.

## Considered options

- **Une seizième clé du contrat** (`exportedCategories`, ou un champ par
  catégorie) — rejeté : « toutes les clés sont obligatoires dès le premier
  module » (`packages/core/src/module.ts`), donc l'ajouter obligerait à rouvrir
  les seize modules déjà écrits pour y déclarer une valeur vide. Et la question
  qu'elle porterait — « pourquoi cette donnée ne sort-elle pas ? » — n'a de
  réponse qu'au cas par cas, en prose : une clé la réduirait à un booléen qui ne
  dit rien.
- **La table d'exceptions dans `config/`** — rejeté : `config/` est ce que le
  propriétaire du projet édite. « `grant-authorship` ne s'exporte pas parce que
  la ligne appartient à un tiers » n'est pas un réglage de projet, c'est une
  propriété du module.
- **La table d'exceptions dans `@repo/core`** — rejeté : le socle ne connaît
  aucun module par son nom, et ne doit pas commencer (`packages/core/AGENTS.md`).
  Le garde reçoit donc la table ; il ne l'écrit pas.
- **Une correspondance catégorie → clés d'export, écrite à la main** — rejeté :
  elle serait juste le jour où on l'écrit et fausse ensuite, sans que rien ne le
  dise, puisqu'aucune commande ne peut deviner quelle clé porte quelle catégorie.
  C'est la « liste recopiée à côté du code » que ce dépôt a déjà vue vieillir
  trois fois.
- **Ne rien vérifier et se fier au commentaire du module** — rejeté : c'est
  l'état d'avant, et c'est le défaut. Le commentaire d'`admin` était juste ; rien
  ne garantissait que le suivant le serait, ni même qu'il existerait.

## Consequences

**Plus facile** : un module qui déclare une catégorie ne peut plus l'oublier en
silence à l'export. Ajouter une catégorie sans l'exporter fait rougir `pnpm test`
en nommant le module — mesuré, deux cas.

**Plus difficile** : toute nouvelle catégorie de données force une décision au
moment de l'écrire, y compris quand la réponse est « rien à exporter ». C'est la
friction voulue.

**À surveiller** : la couverture par module, et non par catégorie, est la limite
connue de ce garde. Un module qui rend une clé et en oublie trois passe au vert.
Le jour où un module déclare des catégories vraiment hétérogènes, il faudra soit
le scinder, soit rouvrir cette décision — pas ajouter une table de
correspondance, qui reproduirait le défaut qu'elle prétend fermer.
