---
story: s39-monitoring-analytics
validated: yes
---

# Plan — s39-monitoring-analytics

> Planifié contre `dev` au commit `8529167`. La recherche est datée de `6f28e5f`, **56 commits plus tôt** : ses faits tiennent, avec **une correction** — elle annonce « quatre ports pour trois adaptateurs », c'est désormais **cinq pour quatre** (`jobs`/Inngest, livrés par `s33`). Cette story livre les **sixième et septième**.

## Ce qui rend cette story facile, et ce qui la rend piégeuse

**Facile** : `s36` a déjà construit le crochet. `CONSENT_CATEGORIES` et `NonEssentialScript` existent (`consent/src/domain/consent-category.ts:18,40`), donc le critère 6 est une **déclaration**, pas un mécanisme. C'est le meilleur cas de cette famille — la story précédente a anticipé celle-ci.

**Piégeuse** : le critère 4 demande les deux régimes que le dépôt pratique déjà — et **le dépôt a déjà payé pour les avoir mal tenus**. Le régime `recorded` du parcours doré **n'a jamais tourné sur des formes Stripe réelles** : `tests/fixtures/stripe-events/` ne porte aucun enregistrement, le job de CI ne s'arme qu'à la première capture versionnée, et une CI verte ne prouve donc rien de la fidélité au fournisseur. **Ne pas reproduire cette moitié-là.**

## Ces deux ports dégradent, et c'est écrit

`docs/reliability.md` : « un tiers absent **dégrade**, il ne casse pas. Pas d'analytics → l'application tourne. » C'est le critère 5.

À l'inverse, l'ADR 050 fait **refuser** le port de limitation quand son magasin est absent — parce que son magasin est la base de l'application. `packages/ports/AGENTS.md` porte déjà cette exception ; ajouter deux ports qui dégradent **remet la règle générale en majorité**, et cela vaut d'être écrit là-bas.

## Tâches

- [x] **1. Les deux ports, et leur contrat de dégradation.** Résultat discriminé, **jamais d'exception**. Chaque code d'erreur annote s'il est transitoire ou définitif, comme `rate-limit` (s28) et `jobs` (s33). Test d'abord sur la forme.
- [x] **2. Le critère 5, mesuré et non affirmé.** Sans clé : l'application démarre, sert, et **aucun appel réseau d'analyse n'est émis**. Le mesurer sur les appels sortants — pas sur l'absence d'erreur. Mutation : un appel émis sans clé doit rougir.
- [x] **3. Le filtrage avant envoi — le seul critère de sécurité de la story.** Une charge utile contenant mot de passe, jeton et cookie de session, et l'assertion porte sur **la requête capturée**, jamais sur l'intention. `docs/security.md` interdit déjà qu'un secret atteigne un journal, une réponse d'erreur **ou la télémétrie** : le critère demande la preuve d'une règle qui existe. Mutation : retirer le filtre doit rougir en nommant le champ qui a fuité.
- [x] **4. L'interface `Analytics` est la seule surface appelée.** Comme le critère 6 de `s32` : un test dérive les appels et refuse un contournement. **Et il porte son plancher** — s32 a montré qu'un balayage sur zéro appelant est vert sans rien vérifier.
- [x] **5. Le régime enregistré, et son plancher.** En CI, les requêtes sont capturées et assertées. **Le plancher est ce qui distingue cette story du régime `recorded` du parcours doré** : la recette doit rougir si elle n'a **rien** à rejouer, plutôt que de passer au vert sur un jeu vide.
- [x] **6. Le régime réel, hors CI, sur commande explicite.** Un test contre un projet PostHog de test. Il ne s'arme jamais en CI, il **saute** plutôt que de se substituer — le modèle est le régime `live` du parcours doré et celui d'Inngest livré par `s33`.
- [x] **7. La déclaration au registre de `s36`.** Le script est non essentiel : aucun chargement ni événement sans consentement. Mutation : le déclarer essentiel, ou le charger avant consentement, doit rougir.
- [x] **8. L'événement de démonstration, de bout en bout.** Une inscription réussie produit son événement, mesuré sur la requête capturée.
- [x] **9. Les cartes source au build.** Le critère 1 demande une trace lisible. Vérifier qu'elles sont **envoyées** et non seulement générées — et qu'elles ne sont pas servies publiquement, ce qui exposerait le code source.
- [x] **10. Module coupé — les trois garanties.** Aucun script déclaré, aucune remontée, **et la bannière de consentement ne s'affiche plus faute de script non essentiel**. La troisième est la plus intéressante : elle traverse deux modules, et `pnpm test:minimal-profile` doit la tenir.

## Ce que la story ne fait pas

Elle n'ajoute pas de tableau de bord ni d'alerte. Elle ne remonte pas les erreurs déjà journalisées par le socle — le journal reste le journal.

## Sections de `docs/security.md` touchées

**Aucun secret dans la télémétrie** — c'est le critère 3, et c'est la seule garantie de sécurité de la story. Cartes source non servies publiquement. Aucun appel sortant sans consentement.
