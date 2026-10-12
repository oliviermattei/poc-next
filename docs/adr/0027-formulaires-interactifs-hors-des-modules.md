# ADR 027 — Un formulaire interactif d'un module vit dans `apps/web`, pas dans le module

- Status: accepted
- Date: 2026-08-31
- Scope: story s11-public-forms

## Context

s11 livre les deux premiers formulaires du dépôt ouverts à un visiteur sans
compte : contact et inscription à la newsletter. Ils appartiennent au module
`marketing` — ses routes, ses règles, ses clés de traduction, sa place dans
l'ordre des sections de `config/marketing.ts`.

Un formulaire interactif poste en JavaScript : il appelle `fetch` vers la route
montée du module, lit le statut de la réponse et affiche une confirmation ou un
refus. Or `eslint.config.ts` **refuse `fetch` dans `packages/modules/**`**, avec
ce message : « Un appel réseau sortant d'un module passe par sa porte bornée
(`infrastructure/oauth-outbound.ts`) : `docs/reliability.md` §3 exige un délai
d'attente explicite, et des reprises en recul exponentiel avec dispersion et
plafond, sur les seules erreurs transitoires. » La règle vient de s12, où un
module appelait un fournisseur d'identité depuis le serveur.

La première écriture de s11 a placé le composant dans
`packages/modules/marketing/src/presentation/public-form.tsx`.
`tests/module-registry.test.ts` — qui passe la configuration réelle du lint sur
chaque fichier de chaque module — l'a refusée. Ce n'est donc pas une préférence
de rangement : c'est une commande qui échoue.

Trois autres modules déclarés au périmètre auront le même besoin — s42 (liste
d'attente), s43 (widget de retour), s44 (feuille de route publique). La question
se posera à chacun, et elle se posera dans les mêmes termes.

## Decision

**Un composant de module qui appelle le réseau vit dans `apps/web`.** Le module
garde la règle, la route, les clés de traduction et **la place** du composant
dans sa page ; il le reçoit en `ReactNode`.

Concrètement pour s11 : `apps/web/app/public-form.tsx` porte le formulaire, et
`MarketingHome` comme `ContactView` déclarent une propriété
(`newsletterForm`, `form`) que l'écran de l'application remplit. Le module décide
**où** le formulaire s'affiche — donc l'ordre des sections reste piloté par
`config/marketing.ts` —, l'application décide **comment** il parle au serveur.

La règle de lint n'est **pas** élargie.

## Considered options

- **Élargir la règle de lint pour autoriser `fetch` dans `presentation/`** —
  rejeté. La règle protège `docs/reliability.md` §3, et la distinction qui
  compte n'est pas la couche mais l'origine de l'appel : un composant serveur
  vit aussi dans `presentation/`, et il appellerait un tiers depuis le serveur
  sans délai d'attente. Une exception par couche rend la garde fausse là où elle
  compte, pour un cas qu'elle ne visait pas. Le dépôt s'est déjà fait prendre
  deux fois par des gardes élargies « pour faire marcher » (modes d'échec 4 et
  13 de `docs/STATE.md`).
- **Autoriser `fetch` quand l'URL est relative** — rejeté. Une règle de lint ne
  lit pas la valeur d'une expression : elle verrait `fetch(action)` sans savoir
  ce que vaut `action`. Une garde qui accepte ce qu'elle ne peut pas vérifier
  n'est pas une garde (même raisonnement que le `method` littéral d'un `<form>`,
  revue de s08).
- **Passer une fonction de soumission en propriété au composant du module** —
  rejeté : impossible. Une fonction ne traverse pas la frontière
  serveur/client de React ; le composant serveur du module ne peut rien passer
  d'exécutable à un composant client.
- **Un formulaire sans JavaScript, `<form action>` natif et redirection de
  retour** — rejeté pour s11. C'est la solution la plus robuste — elle
  fonctionnerait sans script — mais elle exige que la route rende une
  redirection vers la page appelante, donc une destination de retour que
  l'appelant transmet. `docs/security.md` §4 interdit une redirection pilotée
  par un paramètre non validé, et une liste blanche de destinations ajouterait à
  s11 un mécanisme que ni son périmètre ni ses critères ne demandent. **À
  rouvrir** si une story livre un jour une redirection de retour vérifiée : ce
  serait un progrès d'accessibilité réel.
- **Placer aussi la composition de la page dans `apps/web`** (l'application
  assemble titre, carte et formulaire) — rejeté : le module perdrait la
  maîtrise de sa mise en page, et l'ordre des sections de l'accueil cesserait
  d'être décidé par `config/marketing.ts`, ce qui est le premier critère de s10.

## Consequences

**Ce qui devient plus facile.** La règle de `docs/reliability.md` §3 reste
entière et vérifiable par une commande. Le patron est celui que le dépôt suit
déjà depuis s07 avec `app/auth-form.tsx`, qui poste vers les routes du module
`auth` : il y a désormais **une** réponse à cette question, pas deux.

**Ce qui devient plus difficile.** Un module à formulaire n'est plus autonome :
l'installer demande de fournir son composant côté application. La propriété est
**obligatoire** (`newsletterForm: ReactNode`, `form: ReactNode`) et non
facultative, précisément pour que l'oubli soit une erreur de compilation et non
une section vide à l'exécution — c'est le mode d'échec n°9 de `docs/STATE.md`,
un paramètre facultatif à repli silencieux.

**Ce qu'il faut surveiller.** Trois modules à venir (s42, s43, s44) porteront des
formulaires : s'ils recopient la mécanique plutôt que de la partager, quatre
composants divergeront. La question à poser alors n'est pas « où mettre le
formulaire » — cet ADR y répond — mais « ce composant mérite-t-il d'entrer dans
`packages/ui` comme le `Form` que `docs/design-system.md` annonce et que
personne n'a encore construit ». Ce jour-là, la frontière ne changera pas : un
composant de `packages/ui` n'appelle pas le réseau non plus, il reçoit un
gestionnaire de soumission de son appelant.
