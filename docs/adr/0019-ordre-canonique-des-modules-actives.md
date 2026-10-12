# ADR 019 — L'ordre de `enabledModules` est canonique, dérivé de l'annuaire

- Status: accepted
- Date: 2026-08-30
- Scope: framing

## Context
Le critère 8 de s05 exige qu'un toggle suivi du toggle inverse laisse `config/features.ts` **identique**. La seconde revue a montré que c'est impossible tel quel, et pour une raison structurelle, pas pour un défaut d'implémentation.

Un aller-retour, ce sont **deux invocations séparées** du CLI. La première retire le module ; à la seconde, le fichier ne le contient plus, donc sa position d'origine n'existe nulle part. Aucune information sur disque ne permet de la restituer. L'implémentation a donc réinséré au rang de l'annuaire, ce qui **normalise silencieusement** une liste que le propriétaire aurait ordonnée à la main : 1064 allers-retours non identiques sur 1630 dans le balayage exhaustif de la revue.

Deux sorties possibles : mémoriser les positions quelque part — ce qui demande un état que le CLI n'a pas et que le fichier ne doit pas porter — ou faire de l'ordre une propriété canonique.

## Decision
**L'ordre de `enabledModules` est canonique : celui de `availableModules`.** `ks toggle` écrit toujours la liste dans cet ordre.

Conséquence directe, et c'est ce qui sauve le critère 8 : dès la première bascule, le fichier est canonique, et **tout aller-retour ultérieur est identique octet pour octet**. La seule non-identité possible est une normalisation unique, sur un fichier dont l'ordre avait été choisi à la main.

Cette normalisation n'est pas silencieuse : quand `ks toggle` réordonne des entrées existantes, il le **dit en sortie**, en nommant le fichier et la raison.

Le critère 8 se lit donc : *un toggle suivi du toggle inverse laisse le fichier identique, dès lors que la liste est dans l'ordre canonique* — état que le CLI établit lui-même à la première utilisation.

## Considered options
- **Restituer la position d'origine** — rejeté : impossible sans état persistant. À la seconde invocation, l'information n'existe plus. La stocker dans le fichier (un commentaire machine, un tableau de positions) polluerait un fichier dont l'ADR 016 dit qu'il est fait pour être lu et édité à la main.
- **Préserver l'ordre existant et n'insérer qu'en fin** — rejeté : c'est le comportement qui a produit le finding critique. Il ne préserve rien, il déplace le module basculé.
- **Affaiblir le critère 8 dans la story** — rejeté : le critère exprime une vraie exigence (le CLI ne doit pas abîmer le fichier du propriétaire). Le bon geste est de rendre la propriété atteignable, pas d'abaisser l'exigence.
- **Trier alphabétiquement plutôt que par l'annuaire** — rejeté : l'annuaire porte déjà un ordre voulu par le propriétaire, souvent significatif (socle d'abord). L'alphabétique le détruirait.

## Consequences
Facilité : le critère 8 devient atteignable et vérifiable ; `ks toggle` est idempotent au sens du §1 du socle de fiabilité ; l'ordre du fichier cesse d'être une variable cachée.
Difficulté : un propriétaire qui ordonne sa liste à la main la verra réordonnée à la première bascule. C'est un coût réel, payé une fois, et annoncé.
À surveiller : l'ordre d'exécution ne dépend **pas** de cet ordre — il vient du tri du graphe `requires` (s03). Les deux ne doivent jamais être confondus, sous peine de croire qu'éditer le fichier change l'ordre d'application des migrations.
