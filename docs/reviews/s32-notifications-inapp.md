# Revue — s32-notifications-inapp

Diff jugé : `git diff dev...feature/s32-notifications-inapp` (commit `50bda94`, 47 fichiers).

## Ronde 1

### Suites exécutées par le relecteur

| Commande | Résultat |
|---|---|
| `pnpm test` | **2124 passés, 8 sautés**, 70 fichiers |
| `pnpm lint` | aucun problème |
| `pnpm typecheck` | 27/27 |
| `pnpm build` | exit 0 |
| `pnpm test:minimal-profile` | **exit 0** — 6 modules coupés dont `notifications`, 20 routes / 6 entrées / 14 tables balayées absentes, 12 présentes |
| `pnpm test:socle` | **exit 0** — 85 parcours passés, 22 sautés, audit propre |
| Navigateur (Chromium, Postgres réel, 22 lignes semées) | voir plus bas |

### Ce qui tient

**Les deux configurations sont jouées, pas supposées.** Sous `test:minimal-profile`, module coupé, les 28 cas de notification **s'exécutent et passent** — ils ne sautent pas. Les deux gardes dérivés de `notifications.available` affirment la branche inverse et tiennent dans les deux états.

**Le plancher du critère 6 n'est pas creux.** Re-mesuré indépendamment : 4 fichiers émetteurs, 8 occurrences de `mailer.send(`, **8** expressions `template:` extraites — aucune manquée. Planchers à `>=4` / `>=8` / `>=1`, serrés sur le compte du jour.

**Les six templates existants ne sont pas migrés** (mesuré : auth 4 appels, marketing 2, organizations 1, inchangés au diff), conformément à ce que la story exclut. Aucun temps réel, aucun sondage, aucun intervalle : `jobs: []`, et le balayage de `setInterval|websocket|EventSource|poll` ne renvoie que de la prose qui les interdit.

**Quinze clés de contrat déclarées**, `publicUrls: () => []` comprise.

### Table de mutation — huit rouges à leur propre site

| # | Neutralisé | Rouge |
|---|---|---|
| 1 | `notFound()` → `403` | **2** |
| 2 | retrait du destinataire dans `visibleTo` | **6** |
| 3 | `markRead` perd sa portée | **1** |
| 4 | `allowedChannels` ignore une préférence stockée | **3** |
| 5 | retrait du refus de registre vide | **1** |
| 6 | retrait de `notifications.prepare()` | **1** |
| 7 | l'émetteur ignore les canaux retenus | **2** |
| 8 | un module envoie un type déclaré directement | **1** |
| 9 | le catalogue par défaut de `createAppMailer()` gagne les emails de notification | **0** ← F1 |
| 10 | le shell lit `unreadCount` pour un visiteur anonyme | **0** ← F2 |

### Constats

**F1 — majeur — le second filet du critère 6 est décoratif.** `tests/notifications.test.ts:209` construit lui-même `createEmailRenderer(moduleRegistry.emails)` au lieu d'exercer le mailer que les modules reçoivent réellement (`createAppMailer()`). Étendre ce catalogue par défaut avec les emails de notification — la régression exacte que le filet prétend empêcher — laisse **0 rouge sur 2132**, pendant que la phrase écrite dans `apps/web/AGENTS.md`, dans `apps/web/lib/notifications.ts` et dans l'ADR 057 devient fausse. Le critère 6 n'est pas sans protection — le balayage syntaxique mord (mutation 8) — mais le filet vendu comme le recours non syntaxique n'existe pas.

**F2 — majeur — le garde du badge du shell n'est pas là où sa phrase le dit.** Faire lire `unreadCount` au shell pour un visiteur anonyme laisse 36/36 verts. Cause mesurée : un cas antérieur du même fichier laisse en vigueur un `vi.doMock` du registre réduit, si bien qu'à cet endroit `notifications.available === false` et que la branche n'est jamais exécutée. Le code de production est correct ; son filet n'est pas là.

**F3 — mineur — pluriel manquant.** `"screen.unread": "{count} non lues"` : à une seule non lue, l'écran affiche « 1 non lues ». Le dépôt emploie déjà l'ICU `plural` ailleurs — l'idiome existe et n'a pas été utilisé.

**F4 — mineur — un test nomme un invariant qu'il ne tient pas.** « n'affiche aucune pagination quand il n'y a qu'une page » reste vert si l'on rend `Pagination` inconditionnellement, parce que le composant n'émet alors que la page 1 et que l'assertion porte sur l'absence de `?page=2`.

**F5 — mineur, de périmètre, à confirmer par un humain — rien n'émet jamais de notification dans le produit livré.** `emitNotification` n'a aucun appelant de production, les deux types déclarés n'ont aucun producteur, le seed est inchangé : le centre d'un vrai utilisateur reste vide en permanence, alors que l'écran de préférences est vivant. C'est **dans** le périmètre — la story interdit de migrer les six templates existants, le plan l'écrit, l'ADR 057 aussi — mais `organization.member-joined` nomme un événement que le module `organizations` possède déjà, et le câbler aurait rendu les critères 1 à 5 observables de bout en bout.

**F6 — mineur, de processus — aucun `docs/designs/s32-*`.** `/ks-design` n'a jamais été joué sur une story qui porte un écran. Précédent existant (s23 à s28, s30 à s35). L'écran ne compose que des primitives du design system et a été jugé au navigateur à 1280 px et 390 px : correct et lisible.

**F7 — mineur, contre `AGENTS.md` et non contre s32 — le fichier de règles se trompe sur la pile du dépôt.** Il annonce « Hono mounted in Next with oRPC contracts ». Mesuré : **zéro** import `@orpc/*` hors de la liste d'autorisation d'ESLint, **zéro** `from 'hono'` dans `packages/` ou `apps/`. Le répartiteur est `dispatchModuleRequest`. L'implémenteur a eu raison d'ignorer la mention « contrats oRPC » du plan ; c'est le fichier de règles qui est faux, et il continuera d'égarer le prochain agent.

**F8 — mineur, contre le pipeline — `ks scaffold` ne peut jamais être joué en cours de story.** `assertRepositoryClean` est appelé inconditionnellement (ADR 041) ; à l'exécution, un worktree de story est sale par construction — le plan validé lui-même y est non suivi. La commande qu'`AGENTS.md` rend obligatoire est donc inatteignable. Défaut structurel confirmé.

**F9 — mineur, dérive documentaire.** La ligne `pnpm test:socle` d'`AGENTS.md` annonce « deux modules d'écart » entre `config/profiles.ts` et la CI ; s32 porte l'écart à cinq contre trois. Les deux recettes sont vertes, le nombre en prose est périmé.

### Preuve navigateur

Chromium sur `next dev`, Postgres réel, compte réellement inscrit, 22 lignes semées. Vérifiés de visu : liste antichronologique ; pagination 20 + 2 avec page 2 fonctionnelle ; pastille à **19**, comptant l'ensemble et non la page ; après « Tout marquer comme lu » → 303 → pastille disparue, action globale retirée, chaque ligne marquée lue ; préférence basculée et persistée à travers la redirection ; la cible du 303 **garde le préfixe de langue** ; à 390 px rien ne déborde.

### Non vérifié

Aucun navigateur n'a chargé l'écran sous `output: 'standalone'`. **Aucun parcours e2e ne ship pour cet écran** — la preuve ci-dessus n'est donc pas rejouable par la CI. L'émetteur n'a jamais tourné pour de vrai. Thème sombre, navigation au clavier et lecteur d'écran non éprouvés. Concurrence non testée.


## Ronde 2 — après correction de F1, F2, F4 et le repli

| Commande | Résultat |
|---|---|
| `pnpm test` | 2129 passés / 8 sautés |
| `pnpm test:minimal-profile` | exit 0, 6 modules coupés |
| `pnpm test:socle` | exit 0, 85 parcours, arbre propre |

**F1 et F2 fermés, re-mesurés des deux côtés** : 0 rouge sur 2132 en ronde 1, **1 sur 2137** après. Le filet du critère 6 passe désormais par `createAppMailer()` — le mailer que les modules reçoivent réellement — et non par un rendu construit sur place.

**Le repli respecte les défauts déclarés.** Module coupé, un type à `email: false` n'envoie rien ; un type à `email: true` replie sur un email direct. La revendication qui portait tout l'argument — le registre refuse un défaut sur un canal non déclaré *et* un canal déclaré sans défaut, donc une conjonction serait une clause qu'aucune mutation ne peut rougir — a été **vérifiée ligne à ligne** par le relecteur.

### R1 — majeur — l'effacement d'un compte laissait son adresse dans les notifications des autres

`announceArrival` écrivait l'adresse du nouveau venu dans la charge utile de **chaque** autre membre ; `purge({kind:'user'})` efface ce qui est *adressé à* un compte, jamais ce qui le *nomme*, alors que le contrat déclare `retention: 'erase'`. Le dépôt avait déjà traité cette classe consciemment ailleurs (`organizations.purge` lit l'adresse avant d'effacer, puis supprime les invitations qui la nomment).

**Correctif retenu : scinder la charge utile par durée de vie**, plutôt qu'étendre la purge. `data` est rendu maintenant dans l'email puis disparaît ; `stored` est écrit et relu plus tard, et ne porte que des **références**. Les deux sont obligatoires — un repli de l'une sur l'autre aurait rendu l'oubli possible, et l'oubli est ce qui avait écrit l'adresse. `actors` nomme les clés stockées qui portent une référence de compte ; la résolution se fait à la lecture, et un compte disparu rend « Compte supprimé ».

Voie écartée : fouiller les charges utiles à la purge. Elle imposerait que **chaque future charge pense à être fouillable** — une règle qu'aucune commande ne peut vérifier.

**R2 et R5** corrigés. **R3** (boucle d'émission synchrone non bornée) reporté à `s33`, qui livre les jobs. **R4** corrigé sur `dev`.

## Ronde 3 — après la scission de la charge utile

| Commande | Résultat |
|---|---|
| `pnpm test` | 2258 passés / 8 sautés |
| `pnpm typecheck` | 28/28, cache vidé |
| `pnpm test:minimal-profile` | exit 0 |
| `pnpm test:socle` | échec au 1er passage (`e2e/health.spec.ts`, `ECONNRESET`), exit 0 au 2e |

**Le balayage a été re-dérivé** par le relecteur sur neuf motifs et non quatre : **un seul site d'émission de production**, un seul `insert(notification)`, et `db:seed` n'écrit aucune ligne. Les trois mutations annoncées mordent, chacune à son propre site.

**Il a aussi vérifié que les tests n'étaient pas verts par défaut** : `DATABASE_URL` pointée sur un port mort fait passer le fichier de 31 cas à 18. Les 13 cas adossés à PostgreSQL tournent réellement.

### R3-1 — majeur — la moitié « résolution » du correctif n'avait aucun filet

Trois mutations que le relecteur a **inventées**, visant le point de composition — entre le module qui résout et l'écran qui affiche :

| Mutation | Avant | Après |
|---|---|---|
| `displayNamesOf` rend l'adresse au lieu du nom | **0 / 2258** | **1 / 2269** |
| l'écran perd le libellé « Compte supprimé » | **0 / 2258** | **1 / 2269** |
| `notificationScopeOf` rend une portée vide | **0 / 2258** | **1 / 2269** |
| `displayNamesOf` redéploie en une requête par référence | n/a | **1 / 2269** |

La première affichait l'adresse de l'arrivant à tous les autres membres — **la moitié visible du défaut que R1 ferme** — sur une suite entièrement verte. Les deux dérivations vivaient dans une fermeture inatteignable ; elles sont désormais nommées et exportées, donc mutables.

### R3-3 — mineur — une affirmation à l'air mesuré que le point de composition contredisait

Le module écrivait « une résolution par ligne ferait vingt appels ; celle-ci en fait un ». Vrai du module, **faux du produit** : `displayNamesOf` redéployait l'appel groupé en vingt requêtes SQL concurrentes — exactement les vingt que la phrase disait éviter, dans une story dont la réponse à R2 refusait trois requêtes au nom du coût. Corrigé par un `findByIds` (un seul `inArray`), donc la phrase est devenue vraie au lieu d'être retirée.

### Ce que la story ne prouve pas, et qui est écrit dans le module

**La chaîne de purge complète n'est pas exercée.** Le cas de bout en bout purge un registre dont la doublure d'`auth` a une purge vide : le `null` vient de l'annuaire de noms du test, pas d'un compte réellement supprimé. Chaque maillon est mesuré séparément ; leur enchaînement est vérifié à la lecture. C'est écrit dans le `AGENTS.md` du module et dans le commentaire du test, plutôt que laissé passer.

**R3-4 — la limite d'`actors` est honnêtement bornée.** Le mécanisme protège les clés de référence déclarées et ne peut rien pour un texte libre : `{summary}` de `account.security-alert` sera rempli par le premier producteur que livrera `s33` ou `s43`, et une valeur qui y collerait une adresse retomberait dans la même classe. Documenté plutôt que présenté comme couvert — le relecteur a examiné les mécanismes possibles et conclu qu'aucun ne mord réellement sur du texte libre avant que la valeur soit connue.

### Non vérifié

L'écran n'a jamais été rendu au navigateur pour ce delta — l'état « compte nommé disparu » n'existe qu'en test. **Aucun parcours e2e ne couvre les notifications**, donc la preuve navigateur des rondes précédentes n'est pas rejouable par la CI. `output: 'standalone'`, thème sombre, clavier, lecteur d'écran et concurrence : non éprouvés. Le producteur n'a jamais tourné contre un vrai fournisseur d'emails.

Max severity: major
Ship allowed: yes
