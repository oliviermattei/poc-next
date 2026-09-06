# Review — s40-onboarding

> Contexte neuf. Diff jugé : `git diff dev...feature/s40-onboarding` (52 fichiers, +2868/−18).

## Conformité au plan

Les neuf tâches sont présentes et réelles. Les interdits sont respectés : `Stepper` **non copié** (manque reporté dans `docs/design-system.md`), l'édition de profil de `/account` **non réécrite** (`AccountForm` et `AvatarForm` réutilisés), la redirection d'après-inscription vers le second facteur **intacte** (le fichier n'est pas dans le diff), aucune étape que les critères ne nomment.

Deux ajouts non déclarés, tous deux portants et justifiés sur place : `stepsOf` exporté — c'est ce qui rend les mutations M1/M2 possibles **à leur propre site** — et le cas d'usage `proposed`, qui court-circuite la porte avant toute lecture.

## Anti-hallucination

Chaque import ouvert et vérifié. Rien d'inventé.

**Le domaine ne contient aucun nom de module** (vérifié par balayage) : le piège du critère 2 est porté par les **champs** d'une étape, et les suppressions des critères 3 et 8 par `mounted ? … : …` au point de composition. C'est la vraie chose, pas un `if` décoré.

## Mutations — 9, chacune au site où le défaut vivrait, toutes restaurées

| # | Neutralisation | Rouges |
|---|---|---|
| M1 | liste d'étapes écrite en dur | **2** |
| M2 | avatar proposé alors que `storage` est coupé | **1** |
| M3 | porte à sens unique désarmée | **1** |
| M4 | redirection de la racine désarmée | **1** unitaire + **7** parcours navigateur |
| M5 | une étape obligatoire se laisse passer | **2** |
| M6 | `purge` vidée | **1** |
| M7 | contrôle du nom affaibli | **2** |
| M8 | `export` vidée | **2** |
| M9 | `onboarding.prepare()` retiré | **12** |

**M4 répond à la question centrale** : redirection désarmée, `e2e/onboarding.spec.ts` rougit **en même temps** que les six specs adaptées — le raccourci du harnais ne masque pas le critère, et le troisième fichier de test gagne sa place.

**Le raccourci `closeOnboardingCourse` n'est appliqué à aucun parcours dont le sujet est l'atterrissage** : ceux-là utilisent l'atterrissage dérivé, et `e2e/onboarding.spec.ts` n'importe jamais le raccourci. Les deux usages dans `app-shell.spec.ts` portent sur la révocation et le changement de mot de passe, et réassertent `/` après le raccourci — ce qui est en soi un contrôle vivant qu'il a fonctionné.

**Le raccourci et l'atterrissage dérivé le sont réellement**, prouvé et non affirmé : sous `pnpm test:minimal-profile`, module coupé, toute la suite navigateur passe avec des atterrissages sur `/`.

## Constats

**C1 — critical — `pnpm test:golden-path` est cassé par cette story et partirait rouge.**

Les trois parcours du parcours doré inscrivent un compte neuf, le vérifient, le connectent, puis assertent l'atterrissage sur une expression **ancrée**. La nouvelle redirection envoie tout compte au parcours en cours. Mesuré, pas inféré :

```
Expected pattern: /localhost:\d+\/fr$/
Received string:  "http://localhost:3110/fr/onboarding"
3 failed · 1 passed
```

Ce fichier utilise le même `signIn` et n'appelle ni le raccourci ni l'atterrissage dérivé. **Le rayon d'action mesuré par l'implémenteur s'est arrêté à `pnpm test:e2e`** ; `e2e/golden-path/` et `e2e/minimal-profile/` vivent sous d'autres configurations et n'ont pas été balayés.

**La CI ne l'attrape pas aujourd'hui** : le job du parcours doré ne s'arme qu'à la première capture Stripe versionnée, et il n'y en a aucune. Cela partirait donc comme une commande documentée — et le **premier critère de succès du PRD** — silencieusement rouge, dont la story suivante hériterait en l'attribuant à elle-même.

Et ce n'est pas une correction mécanique : quelqu'un doit décider si le fondateur du parcours doré **traverse** le parcours d'intégration — ce que fait désormais un vrai acheteur — ou s'il le ferme comme les autres parcours.

**minor — l'ordre des gardes contredit le docblock du fichier** (`app/onboarding/page.tsx`) : la session est contrôlée avant la disponibilité du module, donc module coupé, un visiteur **anonyme** est redirigé vers la connexion au lieu de recevoir 404. Le docblock annonce 404 « comme `/organizations` », et cette page-là teste bien la disponibilité en premier. Aucune fuite ; l'affirmation est simplement plus large que le code.

**minor — « aucune n'est limitée en débit au-delà du défaut »** : il n'y a **pas** de défaut pour une route non publique. Les deux routes ne sont pas limitées du tout. Ce n'est pas une brèche — elles sont `authenticated` — mais la phrase se lit comme une couverture qui n'existe pas.

**minor — des comptes écrits, non dérivés** : « 38 des 114 parcours ont rougi ». La suite en compte 126 aujourd'hui, et désarmer la redirection en rougit **7**. Ce sont des mesures historiques qu'aucune commande ne maintient vraies, dans un dépôt qui demande de dériver ses comptes et s'est déjà fait prendre là-dessus.

**minor — la porte à sens unique n'est pas armée sur tous les chemins qui terminent le parcours.** La fin n'est enregistrée que lorsqu'une étape est explicitement franchie et qu'il n'en reste aucune. Si la dernière étape **disparaît par dérivation**, le parcours cesse d'être proposé sans être marqué terminé — et quitter l'organisation plus tard le repropose. Borné, non atteignable dans la configuration livrée, couvert par aucun test.

**minor — un identifiant dupliqué** : deux fichiers de harnais comparent le littéral `'onboarding'` là où le point de composition dérive le même identifiant du module.

**minor — aucun `docs/designs/` pour une story qui livre un écran.** Cohérent avec les stories UI récentes, donc dérive de processus à l'échelle du dépôt plutôt que défaut de celle-ci — noté pour ne pas être lu comme vérifié.

## Non vérifié

- **`pnpm test:socle` non joué.** La prémisse de l'implémenteur est vérifiée : la branche socle ne coupe pas `onboarding`, donc le critère 3 y est partiellement exercé.
- **`pnpm test:golden-path` en régime `recorded`** impossible ici, aucune capture n'est versionnée. L'échec porte sur l'atterrissage, en amont de tout régime de paiement.
- **Aucun tiers réel appelé.**
- **La moitié « avatar » de l'étape profil, dans un navigateur** : le parcours ne remplit que le nom. Personne n'a jamais téléversé une image **depuis `/onboarding`**.
- **L'invité, de bout en bout** : le critère 7 est prouvé par dérivation et par un cas unitaire, aucun parcours n'accepte une invitation puis n'observe le parcours amputé.
- **Aucune preuve sous le build de production.** Un point à regarder au passage : sur la capture à 390 px, l'alerte d'étape obligatoire est masquée par la bannière de consentement — comportement préexistant de la bannière.
- **Concurrence sur la table de progression** : l'idempotence est prouvée par rejeu dans un seul processus, jamais par deux soumissions simultanées.

## Verdict

La story elle-même est bien construite : la dérivation est réelle et résiste à la mutation **à son propre site**, le piège du critère 2 est traité par la valeur, la porte mord, l'étape obligatoire ne se laisse ni passer ni forcer, les quatre clés RGPD sont exercées, et la configuration coupée est réellement tenue.

Le seul bloqueur est le rayon d'action : mesuré sur `pnpm test:e2e`, arrêté là. Le parcours doré est rouge, de façon déterministe, et la CI n'est pas en position de le dire.

---

# Revue — ronde 2, après la passe de correction

> Contexte neuf. Diff jugé : 54 fichiers, +3343/−30, commit `33b0240`.

## Les sept recettes, jouées par la revue

`pnpm test` 2868 verts · `test:sans-env` 2868 verts, 101 fichiers · `test:e2e` **118 verts, 0 échec** · **`test:golden-path` 4 verts**, joué **deux fois**, 1 min 08 s et 1 min 10 s · `test:minimal-profile` 6 verts, 12 modules coupés dont `onboarding` · **`test:socle`** exit 0, suite navigateur 102 verts avec `marketing`, `organizations` et `i18n` coupés · `test:contrast` 10 paires.

## Les trois affirmations de tête, vérifiées

1. **Parcours doré vert, fondateur traversant** : la sortie de la revue journalise « parcours d'intégration : traversé par le fondateur (module activé) », avec les deux étapes neuves à **1 s** et **2 s**. Reproduit deux fois, déterministe.
2. **Aucun parcours doré n'utilise le raccourci** — vérifié **par lecture**, pas par la suite : le raccourci n'est référencé que dans deux cas de `app-shell.spec.ts`, et le parcours doré importe la traversée, jamais l'insertion.
3. **Aucun budget relevé** : la constante est intacte dans le diff.

**Le balayage des sept recettes est réel.** `test:socle` est celle que la ronde 1 n'avait jamais jouée, et c'est là que le parcours d'intégration tourne avec `organizations` coupé — donc **deux étapes au lieu de trois**. C'est le mode d'échec « une garde qui ne mord que dans une configuration », fermé par la mesure.

## Mutations de la ronde 2

| Neutralisé | Rouges |
|---|---|
| ordre des gardes rétabli (session avant disponibilité) | **1** sur 23, au bon cas |
| la porte s'arme à **chaque** franchissement | **2** |

## Les cinq mineurs, jugés

L'ordre des gardes est corrigé **et il mord**. La phrase sur la limitation de débit est exacte, et la même phrase fausse vit bien dans un autre module, hors diff — la laisser est un arbitrage de périmètre défendable. Les comptes écrits ont disparu. **La porte à sens unique** : les neuf endroits qui en parlent ont été énumérés, aucun n'affirme plus qu'elle s'arme sur tout chemin terminal, et la conséquence — quitter une organisation avant la fin repropose une étape **facultative** — est cohérente avec la décision prise pour le critère 7. Jugement accepté. Sur l'identifiant dupliqué, **la ronde 1 avait sous-compté** : il y en avait trois, pas deux.

## Balayage P30 — quelque chose suppose-t-il encore l'ancien atterrissage ?

Les 17 sites `urlOf('/')` de `e2e/`, les tests qui rendent la racine, les trois recettes par copie, le profil, et les balayages RGPD — tous ouverts. **Plus rien dans le code ni les fixtures n'encode `/` pour un compte fraîchement connecté.** Ce qui reste est de la prose, ci-dessous.

## Constats restants

**minor** — `apps/web/AGENTS.md` annonce que la racine a **trois** branches ; depuis s40 un visiteur connecté en a une quatrième. Le diff touche ce fichier trois fois et laisse cette ligne.

**minor** — le tableau du docblock de la racine dit « un visiteur connecté → son tableau de bord (**inchangé**) », deux lignes au-dessus du bloc qui le redirige vers le parcours.

**minor** — la ligne `pnpm test:golden-path` de l'`AGENTS.md` racine énumère les étapes et ne mentionne pas la traversée. Signalée plutôt qu'éditée, au motif que c'est un fichier de règles — mais une énumération qui cesse d'être complète est exactement la péremption que ce fichier interdit.

**minor** — une affirmation d'exhaustivité dans le harnais : « le seul endroit où ce module est nommé ». C'est la **comparaison d'identifiant** qui est à source unique, pas le nom.

**minor (inchangé, à l'échelle du dépôt)** — aucun `docs/designs/` pour une story qui livre un écran.

## Non vérifié — les gestes qui appartiennent à un humain

- **Aucune preuve sous le build de production** : toutes les recettes navigateur démarrent `next dev`. Personne n'a jamais chargé `/onboarding` sous `next start`. À 390 px, l'alerte d'étape obligatoire est masquée par la bannière de consentement.
- **La moitié « avatar » n'a jamais été exercée dans un navigateur** depuis cet écran.
- **L'invité, de bout en bout** : prouvé par dérivation et un cas unitaire, jamais par un parcours.
- **Le régime `recorded`** reste injouable : aucune capture Stripe n'est versionnée, donc le job de CI du parcours doré reste désarmé et les deux passages verts étaient `simulated`.
- **Des artefacts d'un passage doré en échec** traînent dans le worktree, une minute avant l'amendement final, avec l'erreur **miroir** de la ronde 1. Non reproduit : deux passages consécutifs sur l'arbre final sont verts. À rejouer sur du matériel de CI avant d'y croire.
- **Concurrence sur la table de progression** : idempotence prouvée par rejeu dans un seul processus, jamais par deux soumissions simultanées.

Max severity: minor
Ship allowed: yes
