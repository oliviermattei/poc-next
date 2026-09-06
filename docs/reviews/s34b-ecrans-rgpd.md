# Revue — s34b-ecrans-rgpd

Story née d'une **omission de plan** relevée en revue de `s34` : son critère 1 décrivait une saisie de confirmation, donc un geste utilisateur, et le plan ne portait aucune tâche d'interface. `s35` a reproduit la même absence. Résultat : **deux droits RGPD livrés, éprouvés, et exerçables uniquement par appel d'API**.

## Suites exécutées par le relecteur

| Commande | Résultat |
|---|---|
| `pnpm lint` · `pnpm typecheck` | exit 0 · 32/32 |
| `pnpm test` | **2531 passés / 11 sautés** |
| `pnpm test:e2e` | **110 passés / 8 sautés**, deux fois, sans intermittent |

Après correction, sur l'arbre rebasé : **2553 passés**, et `pnpm test:sans-env` — la commande que `s55` vient de livrer — **exit 0, 89 fichiers balayés**, jouée pour la première fois sur cette branche.

## Le serveur n'a pas été touché

Vérifié au diff : le seul fichier serveur modifié est `message-keys.ts`, et seulement sa liste tournée vers l'écran. `packages/modules/auth` est intact en entier ; les routes et les cas d'usage d'`organizations` aussi. **Six rondes de revue de `s34` et `s35` restent acquises.**

## Le défaut que l'implémenteur a trouvé lui-même

Retirer `confirmation_mismatch`, `billing_cancel_failed` et `purge_failed` de `ORGANIZATION_REFUSALS` laisse **`pnpm test` entièrement vert** — 2531 passés, inchangé.

Or la route de suppression d'organisation émet ces trois codes **depuis `s34`**, la page valide `?error=` contre cette liste, et **un code absent ne rend rien du tout**. Trois refus étaient donc invisibles à l'écran depuis leur livraison.

**C'est la première fois de la séance qu'un implémenteur applique à sa propre story la classe qu'elle ferme**, sans qu'un relecteur le lui dise. Les trois fois précédentes — `s33`, `s52`, `s55` — il avait fallu la revue.

Fermé au **compilateur** (`Exclude<…> extends never`), le `satisfies` existant ne tenant que l'inclusion inverse. Le relecteur a jugé l'instrument et l'a validé en montrant que **la boucle est fermée sur trois côtés** : *émis ⊆ liste* par le compilateur, *liste ⊆ catalogue* par un test, *accepté = liste* par la même constante. Puis il a piloté le vrai formulaire au navigateur avec un nom erroné, obtenu le 303 vers `?error=confirmation_mismatch`, et **lu le message à l'écran**.

## Les deux majeurs de la revue

**M1 — le critère 5 avait une moitié sans aucune couverture, et c'est celle qui persiste en production.** Le relecteur a posé sa propre mutation : `dataExportStateOf` → `pending: false` laissait **2531 verts et les deux parcours navigateur verts**. Le substitut revendiqué — « l'action disparaît une fois la demande acceptée » — était satisfait par le **drapeau local du client**, pas par l'état dérivé du serveur. Avec l'exécuteur local l'archive est prête au macrotask suivant, donc `pending` ne dure jamais ; **avec un vrai Inngest il dure**.

Fermé des deux côtés — la dérivation et la consommation — et la seconde moitié portait **une seconde mutation verte que personne n'avait posée** : le garde `{pending || accepted}` réduit à `{accepted}` était vert, il rougit.

**Et le correctif a révélé un vrai défaut** : les deux formulaires n'avaient pas d'`action`. Avant hydratation, le repli natif postait vers l'écran courant au lieu de la route du module.

**M2 — `docs/design-system.md` contredisait le code qu'il décrit.** Il inventoriait `ConfirmDialog` comme livré par `s34` — il n'existe pas, ni `AlertDialog` dont il dérive — **et énonçait une règle l'exigeant pour exactement les deux actions que cette story livre sans lui**. La seule trace de la lacune était un commentaire de source que personne lisant le design system ne trouverait.

Corrigé là où ça se lit : la ligne dit « Pas livré », la règle est retirée, et une section nomme ce qui n'existe pas, ce qui a été composé à la place, et **ce qu'il faudrait pour que la règle revienne** — copier `AlertDialog` (ADR 022), composer `ConfirmDialog`, *et* revoir les deux écrans, parce qu'un déclencheur Radix n'ouvre rien avant hydratation là où un formulaire en ligne reste soumissible nativement.

## Table de mutation

| Mutation | Rouges |
|---|---|
| `dataExportStateOf` → `pending: false` | **0 → 1** |
| garde de la carte `pending ‖ accepted` → `accepted` | **0 → 1** |
| trois refus retirés de `ORGANIZATION_REFUSALS` | **0 en test → 1 au typage**, nommant les trois |
| la carte juge la confirmation localement, sans poster | 1 |
| `DeletionRefusal` abandonne la liste d'organisations du serveur | 1 |
| les trois refus d'export effondrés en un seul | 2 |
| garde propriétaire retiré de la zone dangereuse | 1 |

## Ce que l'implémenteur a déclaré plutôt que contourné

**La tâche 8 n'a aucune mutation**, et l'argument a été **vérifié** : `DataExportTrace` porte exactement trois champs, le jeton en clair n'existe qu'entre son émission et l'envoi, la base ne garde qu'une empreinte. Il n'y a aucun site à neutraliser sans inventer une plomberie inexistante. L'assertion de bout en bout — jeton réel lu dans l'email capturé, absent du contenu **et** de l'URL — est un **filet de régression, pas une preuve**.

**Le refus d'une seconde demande n'est pas dans le parcours**, mesuré et non supposé : avec l'exécuteur local, un 409 demande deux demandes **concurrentes** qu'un parcours séquentiel ne peut pas produire. Le refus est tenu au niveau de la classification, avec son message distinct.

## Non vérifié

**Aucun build de production** : le harnais sert `next dev`, donc le chemin du nonce CSP et `output: 'standalone'` n'ont jamais été exercés sur ces deux cartes. **Le 429 et le 503 n'ont jamais été rendus au navigateur**, seulement classifiés depuis une réponse synthétique — de même que le 409 du dernier propriétaire, prouvé par rendu statique. **L'état « en cours » n'a jamais été observé.** Chromium seul : aucun passage lecteur d'écran sur les régions `role="alert"`, ni Safari, ni Firefox, ni parcours clavier de la zone dangereuse. Aucun tiers réel.

Max severity: major
Ship allowed: yes
