---
story: s52-derniers-intermittents
validated: yes
---

# Plan — s52-derniers-intermittents

> Planifié contre `dev` au commit `a621ff3`. La recherche a été **re-vérifiée et enrichie le 05/09** : sa liste passe de sept à onze cas, une de ses contraintes est tombée (la CI n'est plus à l'arrêt), et sa question ouverte n°1 a été **tranchée par la mesure** — voir ci-dessous.

## Ce que la mesure a déjà réglé, et qui change le périmètre

La recherche annonçait que si la piste `spawnSync`/tuyaux se confirmait, **la story changerait de nature : elle corrigerait le script, pas le test.** Elle ne se confirme pas :

- `spawnSync` rend la main en **306 ms** sur un enfant qui dort 30 s, tué par `SIGTERM` avec `ETIMEDOUT`, tuyaux hérités ou non. Le petit-fils orphelin ne le retient pas.
- Le script fait ses **trois tentatives en ~2,7 s, cinq fois sur cinq**.

**Il n'y a pas de défaut de production.** Le `timeout: 20_000` du cas est posé sur le processus `tsx`, dont le démarrage à froid est le poste variable.

## La règle qui structure ce plan

**Une tâche par cause, jamais une tâche par cas.** La recherche l'écrit : *« le risque n'est pas la difficulté d'un cas, c'est de traiter les onze comme une famille »*. Trois causes sont établies, une reste à établir, et le reste doit être **classé avant d'être corrigé**.

Et la sortie facile est interdite par les critères eux-mêmes : **aucune reprise, aucun délai élargi à l'aveugle, aucun saut.** P8 documente ce mode d'échec — un rouge rendu plus rare sans être rendu juste.

## Tâches

- [x] **1. Le compte des cas est dérivé, jamais écrit.** Le critère 4 dit encore « les trois passent dix fois de suite » alors que la liste en porte onze — un compte écrit qui a vieilli, **dans la story dont le métier est de fermer des cas instables**. La liste devient une constante unique, et un test refuse qu'elle soit vide. Le critère se lit sur elle.
- [x] **2. Constater ce qu'une autre story a déjà fermé.** `tests/billing.test.ts` comparait un delta global de `auth_session` ; s50 l'a remplacé par deux sondes, et `grep -c "countRows('auth_session')"` rend **0**. Le constater et le retirer de la liste, plutôt que de rejouer un correctif.
- [x] **3. Cause A — un délai fixe contre un coût de transformation à froid.** **Trois surfaces, une seule cause** : `tests/deployment.test.ts`, `tests/env-wiring.test.ts` et `tests/audit-exceptions.test.ts`. `vitest.config.ts` ne pose **aucun `testTimeout`**, donc 5 000 ms par défaut — exactement la valeur des expirations observées. Ces fichiers chargent le même graphe lourd (`apps/web/next.config` → `next`, `@next/mdx`, `next-intl/plugin`, `startup.ts` et tous les points de composition), **chacun précédé d'un `vi.resetModules()`** qui force la re-transformation complète, dans un clone au cache froid. Le correctif est un délai **explicite et justifié par une mesure**, posé là où le coût est — jamais un délai global élargi, qui masquerait les autres.
- [x] **4. Mesurer le facteur avant de choisir le délai.** Le critère exige une cause écrite *avec la mesure qui l'établit*. On connaît le coût à vide (~2,7 s pour le cas d'audit) ; il faut le coût **sous la charge qui le fait rougir**. Un délai arrondi sans mesure serait exactement le « délai élargi » que les critères interdisent.
- [x] **5. Cause B — une identité partagée entre deux cas.** `e2e/oauth.spec.ts:30` et `:97` pilotent le fournisseur local, qui rend **toujours la même identité** ; en parallèle, le perdant de la course d'insertion échoue sur `auth_user_email_key`. La recherche pose le choix : sérialiser, ou donner une identité par cas. **Donner une identité par cas** — sérialiser cache la course au lieu de la supprimer, et la story interdit de rendre un rouge plus rare sans le rendre juste. La re-vérification renforce ce diagnostic : cette paire rougit sous **trois régimes** (local, CI, recette socle), donc la cause n'est pas le nombre de travailleurs.
- [x] **6. Cause C — une région qui n'apparaît pas.** `e2e/two-factor.spec.ts:162` : la région `status` des codes de secours n'apparaît pas en 5 s. **Mode d'échec distinct** de celui que s50 a réparé sur ce même parcours, qui était un budget de 30 s dépassé — ne pas confondre les deux, et l'écrire dans le test pour que le prochain ne les confonde pas non plus.
- [x] **7. Classer les cas restants avant de les corriger.** `e2e/rate-limiting.spec.ts:38`, `:163`, `:205`, `e2e/blog.spec.ts:134`, `e2e/health.spec.ts` (`ECONNRESET`), la course de migration (`CREATE TABLE "organization"`), `tests/auth.test.ts:765`. Chacun reçoit **une cause écrite ou une mention explicite « non établie »** — jamais un correctif sur une hypothèse. Un cas dont la cause n'est pas établie reste ouvert et nommé ; c'est plus honnête qu'un délai posé au hasard.
- [x] **8. L'hypothèse « quatre travailleurs contre un » est réfutée ou établie, pas répétée.** Elle est reprise dans trois documents sans jamais avoir été mesurée, et **trois des cas ont rougi en CI**, donc à un travailleur. La cause A ne dépend pas du parallélisme. Soit la mesure la confirme sur un cas précis, soit les trois documents cessent de l'affirmer.
- [x] **9. Le régime qui les faisait rougir, dix fois.** Critère 2 : chaque cas corrigé passe **dix fois de suite sous le régime qui le faisait rougir**, avec le compte journalisé. Pas dix fois à vide — dix fois sous charge, ou en CI pour ceux qui n'y rougissaient que là. La CI est revenue, donc c'est désormais possible.
- [x] **10. La discipline est renforcée, pas contournée.** `playwright.config.ts` porte `retries: 0`. Un test refuse qu'une reprise soit introduite, et refuse un `test.slow()` ou un `test.skip` sur les cas de la liste. Sans ce garde, la prochaine story rendra un rouge plus rare au lieu de le rendre juste — et P8 dit que c'est ainsi qu'un contrôle bloquant finit désarmé.

## Ce que la story ne fait pas

Elle ne corrige pas `scripts/audit.ts` : la mesure a montré qu'il coupe son enfant, respecte son délai et compte ses trois tentatives. Elle ne rouvre pas ce que s50 a fermé. Elle n'élargit aucun délai global.

## Sections de `docs/security.md` touchées

Aucune. Story de fiabilité de la vérification, pas de surface produit.

## Ce que l'exécution a mesuré, et où elle s'écarte du plan

Le compte des cas est désormais dans `tests/fixtures/intermittents.ts` : il en
porte **treize**, pas onze — le plan lui-même écrivait un compte qui a vieilli,
comme le critère de la story (« les trois ») et la recherche (« sept cas sur
quatre fichiers », pour huit cas sur cinq fichiers). C'est la raison d'être de
la tâche 1.

**Trois écarts, tous dus à une mesure qui contredit une attente du plan.**

1. **Tâche 3 — le cas d'audit n'a pas reçu de délai.** Le plan le rangeait avec
   les deux autres surfaces de la cause A. Mesuré : le cas coûte 2 177–2 479 ms
   à vide (6 passages), 3 224–3 903 ms sous 64 boucles de calcul (6 passages) et
   2 443–3 077 ms sous une tempête de forks à 716 processus (12 passages), les
   trois tentatives étant comptées 24 fois sur 24. Le filet extérieur de
   20 000 ms garde donc plus de cinq fois de marge à huit fois la charge
   nominale, et `expected 2 to be 3` n'a **pas** été reproduit. Élargir ce
   délai-là aurait été le « délai élargi » que les critères interdisent. Ce qui
   est posé est diagnostique : quand le filet coupe, le cas le dit
   (`ETIMEDOUT`), au lieu de rendre un compte de tentatives trompeur. Le cas
   reste **ouvert et non établi**.
2. **Tâche 6 — la « cause C » n'en est pas une, et le correctif attendu est
   réfuté.** Mesuré entre le clic sur « Confirmer » et l'apparition de la région
   `status` : 232, 227, 198 ms à vide et 235 ms sous la suite complète avec huit
   boucles de calcul, contre un défaut de 5 000 ms — vingt et une fois de marge.
   Ce n'est pas un budget. Écarté aussi : le glissement de période TOTP, la
   bibliothèque acceptant ±1 période. Le cas reste **ouvert et nommé**, avec la
   mesure écrite à l'endroit du test.
3. **Tâche 7 — la course de migration est établie mais non corrigée.** Quatre
   fichiers de `tests/` appellent `runModuleMigrations` dans leur `beforeAll`
   contre la même base, dans des travailleurs parallèles ; le migrateur de
   Drizzle est idempotent par son journal, pas concurrent. Le correctif (verrou
   consultatif, ou passe unique avant les travailleurs) change le contrat de
   migration de `@repo/db` et demande une connexion dédiée : c'est une décision
   de structure, elle se prend au plan. Elle est écrite au point de composition.

**Ce que la tâche 8 a réglé.** L'hypothèse « quatre travailleurs contre un » est
**établie sur un cas précis** — les deux cas 2FA de `e2e/rate-limiting.spec.ts`
tiraient leur défi de `Date.now()` seul ; écart mesuré entre les deux à quatre
travailleurs sur quinze passages : 3, 2, 44, 1, 42, 12, 13, 12, 53, 26, 31, 2,
52, **0**, 22 ms, et le passage à 0 ms est exactement celui qui a rougi, les deux
cas ensemble. À un travailleur : 456, 364, 348, 292, 107 ms, collision hors
d'atteinte. Et elle est **réfutée comme explication d'ensemble** : la cause A
n'implique aucun travailleur Playwright et se reproduit à la demande en saturant
le processeur. `docs/stories.md` porte désormais la mesure ; `docs/killer-saas-feedback.md`
(P12) écartait déjà le compte de travailleurs pour son propre cas, il n'avait
rien à corriger.

**Tâche 9 — dix passages, sous le régime qui faisait rougir.**

| Famille corrigée | Régime | Compte |
|---|---|---|
| Cause A (`deployment`, `env-wiring`) | Vitest, 8 boucles de calcul sur 8 cœurs | **10/10 verts** |
| Cause B (paire OAuth) | Playwright, 4 travailleurs, identité effacée avant chaque passage | **10/10 verts** |
| Défi 2FA (`rate-limiting`) | Playwright, 4 travailleurs | **10/10 verts** |

## Second passage — ce que la revue a fait bouger

Branche rebasée sur `origin/dev` (`c0d69b7`), ce qui apporte `a621ff3` — la base
de planification citée en tête — et `tests/jobs.test.ts` de s33, quatrième
appelant du graphe lourd.

- **La règle du créneau est éprouvée à la porte, pas seulement au domaine.** Le
  repli silencieux `localOAuthIdentity(x) ?? localOAuthIdentity(null)` posé sur
  la route laissait toute la suite verte : c'est là que l'étiquette arrive d'un
  appelant extérieur, et c'est là que le repli ramènerait la course. Trois cas
  de route dans `tests/auth.test.ts` — refus 400 **sans redirection vers le
  rappel**, créneau transporté jusqu'au rappel, identité par défaut sans créneau.
- **La garde des échappatoires lit les arguments, plus une forme d'écriture.**
  Elle manquait `test.skip()` nu, `test.describe.configure({ retries: 3 })` et
  une reprise posée sur un projet. Elle balaie désormais le fichier sans ses
  commentaires, compte les parenthèses pour distinguer un saut inconditionnel
  d'un `test.skip(<condition>, '…')` dérivé du catalogue, et exige que **toute**
  valeur de `retries` de `playwright.config.ts` vaille zéro.
- **La cause A vaut pour tous ses appelants, ou s'explique.** La liste est
  balayée sur le disque depuis `COLD_GRAPH_ENTRY_POINTS` ; chaque appelant porte
  le délai ou figure dans `COLD_GRAPH_MEASURED_WITH_MARGIN` avec sa mesure. Les
  quatre joués ensemble sous seize boucles, cinq passages : `deployment`
  7 184–7 551 ms et `env-wiring` 6 925–7 465 ms (délai explicite), `jobs`
  2 318–2 499 ms et `admin` 634–768 ms (mesurés, deux et six fois de marge — leur
  poser le délai serait un délai élargi sans cause). Un cinquième appelant fait
  rougir.
- **Trois « trois » retirés de la section s52 de `docs/stories.md`** : le titre,
  et deux notes. Le critère dit maintenant ce qui est réellement vérifié — le
  plancher de la liste — et admet qu'aucune commande n'interdit à un document de
  réécrire le compte : seule la dérivation le rend inutile.
- **Citation corrigée** : la tolérance de ±1 période est celle de la
  bibliothèque (`window = 1`, `@better-auth/utils@0.4.2/dist/otp.mjs:42,50`) ;
  `totpStepsToTry` est la garde de rejeu de ce dépôt, sur `[c-2, c-1, c, c+1]`.

Laissés ouverts, comme la revue le demande : les deux `ECONNRESET`, la course de
migration, le cas d'audit et la région `status` du second facteur.
