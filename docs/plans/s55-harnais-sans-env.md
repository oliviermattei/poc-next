---
story: s55-harnais-sans-env
validated: yes
---

# Plan — s55-harnais-sans-env

> Planifié contre `dev` au commit `b4fd11a`. Story née de P29, dont le coût d'inaction est **mesuré** : trois rouges de CI en trois stories consécutives, toujours la même cause.

## Le défaut, et pourquoi une quatrième écriture ne suffirait pas

Un fichier de `tests/` atteint la configuration d'authentification — par `appAuth()` ou par un point de composition — sans déclarer `AUTH_SECRET` et `APP_URL`. Le `.env` du poste les fournit ; le job de CI non. Le fichier est vert chez l'agent, rouge en intégration.

`AGENTS.md` porte la règle depuis `s18`/`s19`, P25bis l'a reprécisée après `s32`, et `tests/admin.test.ts` en donne un précédent exécutable. **Trois écritures, trois infractions** — `s32` en ronde 3, `s34` évitée de justesse parce que son garde lisait la source, `s35` en échec de suite.

Ce qui manque n'est pas une quatrième écriture, c'est la commande. *Une règle qu'aucune commande ne vérifie est de la documentation.*

## Ce que la commande doit reproduire, et le piège

**La CI ne fournit pas *rien*.** Mesuré dans `.github/workflows/ci.yml`, le job en fournit exactement **trois** : `DATABASE_URL`, `EMAIL_LOCAL_CAPTURE=1`, `PAYMENTS_LOCAL_MODE=1`.

Une commande qui reproduirait l'absence **totale** rougirait sur des fichiers corrects et finirait désarmée — P8 documente ce mode d'échec, et c'est la pire issue possible : un contrôle bloquant de plus que personne ne regarde.

**Et l'ensemble se dérive, il ne se recopie pas.** Une liste écrite dans le script vieillirait à côté du workflow, exactement comme le chemin des traces que `s51` a dû corriger. Le motif existe et il est éprouvé : `scripts/socle-rules.ts` dérive déjà les étapes du job gardé depuis `ci.yml`.

## Tâches

- [x] **1. L'ensemble d'environnement est dérivé de `ci.yml`.** Lire le bloc `env:` du job qui joue `pnpm test`, et en tirer les variables et leurs valeurs. Test : ajouter une variable au workflow la fait apparaître dans l'ensemble dérivé ; en retirer une la fait disparaître. **Ne pas recopier les trois noms** — c'est le défaut que la story existe pour empêcher, appliqué à elle-même.
- [x] **2. Le plancher.** La dérivation refuse un ensemble vide, et refuse de ne trouver aucun fichier de test. Sans ce plancher, une expression qui cesse de correspondre rend la commande verte en ne vérifiant rien — le défaut trouvé en `s26`, en `s48`, puis en `s51`.
- [x] **3. `pnpm test:sans-env` joue la suite sans le fichier `.env`.** Le mécanisme doit empêcher `loadRootEnv()` de le lire — P25bis a établi que **désarmer les variables du shell ne reproduit rien**, puisque la fonction relit le fichier sur le disque. Travailler dans une copie, ou neutraliser le chemin lu : décider et écrire pourquoi.
- [x] **4. L'échec nomme le fichier et la variable.** Le critère 2 l'exige, et c'est ce qui distingue cette commande d'un simple second passage : un rouge qui dit « quelque chose manque » coûte le même aller-retour que la CI. Le message doit permettre de corriger sans relancer.
- [x] **5. Le régime inverse est vérifié aussi.** Un fichier qui déclare l'intégralité de ce qu'il lit passe **dans les deux régimes**. La commande ne doit pas demander de désarmer ce que le harnais fournit légitimement — sinon elle pousse à appauvrir les tests pour la satisfaire.
- [x] **6. La CI la joue, ou son absence est écrite.** Si elle y entre, `scripts/socle-rules.ts` en dérive les étapes et forcera une décision de disposition — le vérifier plutôt que le supposer. Si elle n'y entre pas, la raison est écrite : une commande de diagnostic local qu'aucune CI ne joue reste utile, mais il faut le dire.
- [x] **7. Mutation, à l'endroit du défaut.** Retirer la déclaration d'environnement d'un fichier de test existant — `tests/data-export.test.ts` est le cas réel le plus récent — doit faire rougir `pnpm test:sans-env` **en le nommant**, alors que `pnpm test` reste vert. Si les deux rougissent, la commande ne mesure rien de neuf ; si aucune ne rougit, le filet est plus étroit que son nom.

## Ce que la story ne fait pas

Elle ne corrige aucun fichier de test existant : ils passent tous aujourd'hui, la commande est là pour le prochain. Elle n'ajoute pas de garde statique sur les imports — cette forme **devinerait** ce qui sera lu, là où une exécution le **mesure**.

## Sections de `docs/security.md` touchées

Aucune. Story de harnais. Elle touche cependant à la validation d'environnement, dont dépend le refus de démarrer sans secret : ne pas affaiblir ce refus pour faire passer la commande.
