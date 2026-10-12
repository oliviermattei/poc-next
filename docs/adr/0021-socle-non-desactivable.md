# ADR 021 — Le socle non désactivable est une liste validée, pas une phrase

- Status: accepted
- Date: 2026-08-31
- Scope: story s07-signup-signin

## Context
`config/features.ts` écrivait, à propos de `auth` : « `auth` fait partie du socle non désactivable […] le retirer ferait échouer la validation des modules qui le requièrent ». La revue de s07 a vérifié : **aucun module ne déclare `requires: ['auth']`**. Rien n'empêchait donc `ks toggle auth`, et l'état obtenu n'est pas un état vide inoffensif — les écrans `/sign-up`, `/sign-in`, `/account`, `/forgot-password` et `/reset-password` vivent dans `apps/web`, continuent d'être servis, et postent vers des routes qui répondent 404. Mesuré dans cet état : `pnpm test:e2e` rouge, cinq cas.

La *Definition of Done* du plan affirmait « vert dans les trois états de configuration ». C'était faux, et la cause n'était pas un défaut d'implémentation : c'était une règle écrite en prose, que rien n'exécutait. Le dépôt s'est déjà fait prendre à cette forme exacte — une garde de frontière qu'un guillemet défaisait (voir la surface client de `@repo/config` et l'import de `@repo/db` dans un module). **Une règle qu'aucune commande ne fait échouer n'est pas une règle.**

## Decision
**Le socle est une liste explicite, `requiredModules`, déclarée dans `config/features.ts` et validée à la résolution de la configuration.**

`resolveEnabledModules` reçoit cette liste au même titre que l'annuaire et les modules activés, et refuse deux choses en les nommant :

- un module du socle **absent de `enabledModules`** — « fait partie du socle et ne peut pas être désactivé » ;
- un module du socle **absent de l'annuaire** — sans quoi une faute de frappe désarmerait la règle en silence, le module nommé ne manquant jamais.

Le refus a la même forme que celui d'un requis manquant, et il vient du même endroit. Les trois points de composition transmettent la liste : le registre de l'application, la génération de schéma, l'application des migrations. Le CLI la transmet aussi — `bin.ts` la lit dans `config/features.ts` et la fait suivre à `planToggle`, qui **soumet la configuration candidate** à la validation au lieu de rejouer la règle. `ks toggle auth` est donc refusé avant toute écriture.

Conséquence assumée : **« tous les modules coupés » n'est plus un état de configuration valide** de ce dépôt. Les trois états à éprouver deviennent : la configuration livrée, tous les modules activés, et la configuration réduite au socle. L'état où `auth` est coupé est désormais *refusé* — ce qui est une réponse, là où il était *cassé*, ce qui n'en était pas une.

## Considered options
- **Déclarer `requires: ['auth']` dans les modules qui en dépendent** — rejeté comme solution *suffisante*. C'est vrai et souhaitable pour un module qui lit une session, mais ça ne protège rien tant qu'aucun module de ce genre n'est activé : le dépôt livré aujourd'hui n'en a aucun, et c'est précisément l'état où le trou était ouvert. La dépendance réelle n'est pas entre modules, elle est entre `auth` et les **écrans de l'application**, que le graphe des modules ne voit pas.
- **Un drapeau sur la définition de module (`socle: true`)** — rejeté : c'est le contrat de module (ADR 007) qu'il faudrait rouvrir, pour y mettre une propriété qui n'appartient pas au module mais au **projet** qui l'installe. Le même module, dans un autre dépôt, peut légitimement être optionnel.
- **Une constante `NON_DISABLEABLE_MODULE_IDS` dans `@repo/core`** — rejeté pour deux raisons. `@repo/core` ne connaît pas `config/features.ts` et ne doit pas connaître l'identifiant `auth` : la configuration est **reçue**, jamais lue, c'est ce qui permet aux tests de construire d'autres registres. Et une constante appliquée par défaut casserait tous les registres d'essai qui n'incluent pas le socle — ils cesseraient d'éprouver ce qu'ils éprouvent.
- **Consigner que l'état vide n'est plus valide et corriger la DoD** — rejeté seul : c'est de nouveau une phrase. Elle est écrite ici, mais accompagnée du refus qui la rend vraie.
- **Laisser le CLI porter la règle** — rejeté : le CLI n'est pas la seule porte. Un `config/features.ts` édité à la main doit être refusé au démarrage, comme un cycle l'est déjà.

## Consequences
Facilité : couper `auth` est refusé **par son nom**, dans le CLI comme au démarrage de l'application et de la génération de schéma ; la DoD redevient vraie ; le mécanisme est générique — un futur socle (paiement, organisations) s'y ajoute par une ligne.
Difficulté : `requiredModules` est une décision de produit, pas une commodité. Y ajouter un identifiant retire à l'utilisateur du boilerplate le droit de couper ce module ; la liste doit rester courte et justifiée.
À surveiller : la liste est facultative pour `resolveEnabledModules` (vide par défaut), afin que les registres d'essai restent libres. C'est ce qui rend possible qu'un point de composition oublie de la transmettre — d'où un cas qui éprouve la chaîne complète jusqu'au binaire `ks`, et un autre qui éprouve la configuration réelle du dépôt privée de son socle.
