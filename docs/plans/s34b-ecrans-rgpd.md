---
story: s34b-ecrans-rgpd
validated: yes
---

# Plan — s34b-ecrans-rgpd

> Planifié contre `dev` au commit `7915b23`. Story née d'une **omission de plan** que la revue de `s34` a relevée : son critère 1 décrivait une saisie de confirmation, c'est-à-dire un geste utilisateur, et le plan ne portait aucune tâche d'interface. `s35` a reproduit la même absence.

## Ce que la story livre, et ce qui existe déjà

Le serveur est **fait et éprouvé des deux côtés**. `POST /auth/delete-account`, `POST /organizations/delete` et la route de demande d'export existent, avec leurs refus mesurés par mutation. Les commentaires de route disent déjà que `POST` est choisi « parce que la route est appelée par un `<form>` d'écran » — **ce formulaire est ce que cette story livre**.

Aujourd'hui, **deux droits RGPD s'exercent uniquement par appel d'API**. C'est le seul endroit du produit où une fonctionnalité livrée n'a aucun point d'entrée.

## Trois contraintes qui viennent des revues, pas des critères

**1. L'écran ne décide de rien.** La confirmation par saisie est présentée à l'écran ; la comparaison reste **côté serveur**, et `s34` a une mutation qui rougit si on la déplace. L'écran affiche, poste, et rend le refus — il ne valide pas.

**2. Le jeton d'export ne doit jamais atteindre l'écran.** Le lien part par email et sa route est **publique**. L'écran montre l'**état** de la demande. Ne pas le rendre, ne pas le mettre dans une URL de page, ne pas le journaliser.

**3. Les refus existent déjà et sont nombreux.** L'export en refuse trois — demande déjà en cours, débit dépassé (429), mise en file refusée (503) — et la suppression en refuse un qui compte : le dernier propriétaire, avec la liste des organisations concernées. Le relecteur de `s35` a noté qu'**il n'existe aujourd'hui aucun écran pour afficher le 429**. Un refus rendu comme une erreur générique est une régression de ce que le serveur a soigneusement distingué.

## Tâches

- [x] **1. La zone dangereuse de l'écran de compte.** Une affordance de suppression, **séparée des autres cartes et visuellement distincte d'une action réversible**. Composée exclusivement du design system — `s49` a livré la famille sémantique et ses contrastes mesurés ; `destructive` est faite pour ça et ne s'invente pas.
- [x] **2. La confirmation par saisie, présentée sans être jugée.** L'écran demande l'adresse ; le serveur compare. Test : le formulaire poste ce qui est saisi, et un écran qui déciderait localement serait un défaut — la mutation de `s34` le tient déjà côté serveur, celle-ci tient que l'écran ne double pas la décision.
- [x] **3. Le refus du dernier propriétaire, rendu tel qu'il arrive.** Le serveur rend 409 avec **la liste des organisations**. L'écran l'affiche sans la deviner ni la reconstruire — un écran qui referait le calcul aurait deux vérités.
- [x] **4. L'écran d'organisation : la même affordance pour un propriétaire, rien pour un membre.** Le serveur répond déjà 404 à un non-membre et refuse un membre non-propriétaire ; l'écran ne montre pas ce qu'il ne peut pas faire.
- [x] **5. La demande d'export, sur le même écran.** Et **l'état d'une demande en cours** plutôt qu'un second bouton : le critère 7 de `s35` refuse la seconde demande, donc l'écran qui la propose ment. Afficher l'état, pas l'action indisponible.
- [x] **6. Les trois refus de l'export, lisibles.** Déjà en cours, 429, 503. Chacun a son message ; aucun ne doit apparaître comme une erreur générique. C'est le point que la revue de `s35` a signalé comme manquant.
- [x] **7. Un parcours navigateur couvre les deux droits, de bout en bout.** **C'est la garantie qui manque le plus** : ni `s34` ni `s35` n'ont aucun parcours, et leurs preuves de revue ne sont donc pas rejouables par la CI. Suppression : saisir, confirmer, constater la révocation de session. Export : demander, constater l'état, constater le refus d'une seconde demande.
- [x] **8. Le jeton ne fuit nulle part.** Test : la page d'état ne contient pas le jeton, l'URL non plus. C'est une frontière publique qui donne accès à toutes les données d'une personne.

## Ce que la story ne fait pas

Elle ne change **aucune** route ni aucun refus : le serveur est éprouvé, et le modifier ici rouvrirait des mutations mesurées sur deux stories. Elle n'ajoute pas d'écran d'administration — c'est `s37b`.

## Design

Pas de `docs/designs/s34b*`. Le dépôt a livré ses écrans sans document de conception depuis `s23`, et cette story compose **exclusivement** des composants existants. Un besoin que le design system ne couvre pas se signale comme lacune, il ne s'invente pas.

## Sections de `docs/security.md` touchées

`<form>` déclarant `method` en littéral écrit — un formulaire React sans lui retombe sur un GET du navigateur avant hydratation et met la saisie dans l'URL, mesuré en `s08`. Aucune décision de sécurité côté client. Le jeton d'export ne traverse jamais l'écran.
