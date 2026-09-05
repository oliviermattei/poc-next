# Research — Story s52-derniers-intermittents

> Vérifiée contre la branche par défaut au commit `201bf64`, en lecture seule.
> Aucune base, aucun conteneur, aucun worktree.

## Les cinq faits structurants

1. **La story en porte sept, pas trois, et son propre critère dit encore « les trois ».** La liste a grossi de story en story — `tests/audit-exceptions.test.ts`, `e2e/rate-limiting.spec.ts` **:38, :163 et :205**, la paire `e2e/oauth.spec.ts` **:30/:97**, `e2e/blog.spec.ts:134`, `e2e/two-factor.spec.ts:162` — soit **sept cas sur quatre fichiers**, pendant que le critère 4 continue de dire « les trois passent dix fois de suite ». Un compte écrit qui a vieilli, **dans la story dont le métier est de fermer des cas instables**. À corriger au plan, et à dériver plutôt qu'à réécrire.
2. **Un cas de la liste d'origine est déjà fermé, par une autre story.** `tests/billing.test.ts` comparait un delta **global** de `auth_session` ; s50 l'a remplacé par deux sondes, et `grep -c "countRows('auth_session')" tests/billing.test.ts` rend désormais **0**. La story doit constater cette fermeture au lieu de la rejouer.
3. **Deux causes sont déjà établies, et ce sont les seules.** La paire OAuth : les deux cas pilotent le fournisseur **local**, qui rend toujours la même identité ; joués en parallèle, celui qui perd la course d'insertion échoue sur `duplicate key value violates unique constraint "auth_user_email_key"`. Et `e2e/two-factor.spec.ts:162` : la région `status` des codes de secours n'apparaît pas en 5 s — **mode d'échec distinct** de celui que s50 a réparé sur ce même parcours, qui était un budget de 30 s dépassé. Ne pas confondre les deux.
4. **L'explication « quatre travailleurs contre un » n'a jamais été établie.** Elle est plausible — la CI emploie **un** travailleur, le local quatre — et elle est répétée dans trois documents, mais aucune mesure ne la confirme. Trois des sept cas ont d'ailleurs rougi **en CI**, donc à un travailleur : `two-factor:162` sur la demande de fusion 11, et les deux de `rate-limiting` en revue de s30. **L'hypothèse ne couvre donc pas tous les cas**, et la traiter comme acquise ferait chercher au mauvais endroit.
5. **Pour `tests/audit-exceptions.test.ts`, l'arithmétique écarte l'explication évidente.** Le faux `pnpm` dort 30 s par appel, le script pose son propre délai à **300 ms** (`AUDIT_TIMEOUT_VARIABLE`), et `AUDIT_BACKOFF` vaut `{ baseMs: 500, maxMs: 4000 }` — trois tentatives coûtent donc au pire **~1,8 s**, très loin des **20 s** du `timeout` que le cas pose sur son propre processus. Le recul n'est **pas** la cause. Le symptôme observé est `expected 2 to be 3` : deux tentatives démarrées au lieu de trois, le compteur étant incrémenté **avant** le `sleep`. Ce qui reste à établir : ce qui consomme les ~20 s. **Piste, non vérifiée** : `spawnSync` peut rester bloqué sur les tuyaux hérités tant qu'un petit-fils (`sleep`) les tient, même après que son délai a tué le shell — auquel cas le défaut n'est pas dans le test mais dans la façon dont le script coupe son enfant, ce qui **compterait aussi en production**.

## Target story

Cinq critères : les cas nommés ne dépendent plus d'une course ni du nombre de travailleurs · ils passent **dix fois de suite sous le régime qui les faisait rougir**, avec le compte journalisé · aucune reprise, aucun délai élargi, aucun saut · la cause de chacun est **écrite à l'endroit du test**, avec la mesure qui l'établit.

Dépendances déclarées : `s19-subscribe-stripe`, `s13-two-factor` — les deux fusionnées, mais la liste a débordé leur surface : elle touche aussi `s28` (limitation), `s12` (OAuth), `s29` (blog) et `s48` (audit).

## Points d'ancrage

- `tests/audit-exceptions.test.ts:452-489` — le cas, son faux `pnpm`, son `timeout: 20_000` et son commentaire qui dit que ce délai « n'est pas celui qu'on éprouve ».
- `scripts/audit-exceptions.ts:71,127,138` — `AUDIT_ATTEMPTS`, `AUDIT_BACKOFF`, `auditBackoffMs`, tous exportés donc injectables.
- `e2e/oauth.spec.ts:30` et `:97` — les deux cas qui partagent une identité.
- `e2e/two-factor.spec.ts:162` — la région `status` des codes de secours.
- `e2e/rate-limiting.spec.ts:38`, `:163`, `:205` · `e2e/blog.spec.ts:134`.
- `playwright.config.ts` — `retries: 0`, discipline que la story doit **renforcer**, jamais contourner.

## Pièges & contraintes

- **La sortie facile est interdite par les critères eux-mêmes** : une reprise Playwright, un `test.slow()`, un délai élargi rendraient le rouge plus rare **sans le rendre juste**. P8 du retour d'expérience documente ce mode d'échec, et il est la raison d'être de la story.
- **Sept cas, quatre fichiers, six stories d'origine.** Le risque n'est pas la difficulté d'un cas, c'est de traiter les sept comme une famille alors que le fait 3 en donne déjà deux causes **distinctes**.
- **Un cas peut être un défaut du produit, pas du test.** Le fait 5 le montre pour l'audit : si le script ne coupe pas son enfant, le défaut compte en production. Stabiliser le test le masquerait.
- **Ne pas rouvrir ce que s50 a fermé** (fait 2).
- **La CI est à l'arrêt au niveau du compte** (`docs/STATE.md`) : les cas qui ne rougissent qu'en CI ne pourront pas être reproduits tant qu'elle ne repart pas.

## Questions ouvertes

- **Que consomme les 20 s du cas d'audit ?** À établir avant tout correctif — la piste `spawnSync`/tuyaux du fait 5 est une hypothèse, pas une conclusion. Si elle se confirme, la story change de nature : elle corrige le script, pas le test.
- **La paire OAuth : sérialiser, ou donner une identité par cas ?** Le fournisseur local rend toujours la même identité. Sérialiser cache la course ; une identité par cas la supprime. La seconde est meilleure et probablement plus simple.
- **`two-factor:162` : pourquoi la région `status` n'apparaît-elle pas ?** Aucune cause établie. C'est le seul cas dont on ne sait rien, et le seul qui ait rougi en CI **et** en local.
- **Faut-il un régime de reproduction déclaré ?** Le critère 2 dit « sous le régime qui les faisait rougir » et la story écrit « quatre travailleurs en local » — que le fait 4 contredit pour trois des sept. À reformuler sur ce qui a été mesuré.
- **Les sept doivent-ils tenir dans une seule story ?** Quatre fichiers, six origines, au moins trois causes. Si le plan dépasse dix tâches, la ligne de coupe naturelle est **par cause établie**, pas par fichier.

## Complexité réelle

Notée **2** dans `docs/stories.md`. **Ma note : 4.**

La note de 2 a été posée quand la liste comptait deux cas d'une même surface. Elle en porte sept, sur quatre fichiers, issus de six stories, avec **au moins trois causes distinctes dont une seule est comprise à moitié**. Et le fait 5 ouvre la possibilité qu'un des cas soit un défaut de production déguisé en test instable — auquel cas ce n'est plus du tout la même story.

**Proposition de découpe, à trancher au plan** : les cas dont la cause **est établie** (la paire OAuth, et l'audit si le fait 5 se confirme) d'un côté ; ceux dont la cause reste à trouver (`two-factor:162`, `blog:134`, les trois de `rate-limiting`) de l'autre. La première close seule et vite ; la seconde est une enquête, et mélanger une enquête à un correctif fait traîner les deux.
