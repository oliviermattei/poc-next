# Revue — s37b1-decompte-et-impersonation

Le diff le plus sensible du projet : il ferme une dette de sécurité **mesurée et irréparable en production**, et livre un cookie de session écrit à la main pour une élévation de privilège. **Deux rondes de revue, trois de correction.** Sévérité : `critical` → `major`.

## Suites exécutées par le relecteur

| Commande | Résultat |
|---|---|
| `pnpm test` | **2574 passés / 11 sautés** |
| `pnpm typecheck` · `pnpm lint` | 32/32 · aucun problème |
| `pnpm test:minimal-profile` | vert, `admin` parmi 9 modules coupés, sa table absente d'`information_schema` |
| `pnpm test:sans-env` | vert, 88 fichiers |
| `pnpm test:e2e` | **108 passés / 8 sautés** |

Les 52 cas de `tests/admin.test.ts` ont été vérifiés comme s'exécutant **contre le vrai PostgreSQL**, en rapport détaillé, à travers le répartiteur et le chemin de cookie de production. Seule doublure injectée : le garde de limitation permissif.

## Ce qui a été vérifié plutôt que cru

**Le balayage dont dépend toute la forme.** Le seul écrivain SQL de `auth_user.banned` est `setBanned`, atteignable uniquement par le port, sous verrou. Le relecteur l'a **re-dérivé indépendamment** et a fermé un trou que le balayage initial ne nommait pas : `/update-user` de la bibliothèque passe le corps par `parseUserInput`, et le dépôt ne déclare **aucun** `user.additionalFields` — `banned` n'est donc pas écrivable depuis un corps de requête.

**Le cookie écrit à la main, contre la source installée.** `better-call@1.4.0` ouvert, pas la mémoire : `btoa(HMAC-SHA256(value, secret))`, `${value}.${signature}`, `encodeURIComponent` — **identique octet pour octet**. `getSignedCookie` exige une signature de 44 caractères terminée par `=` : satisfait. L'ordre des attributs correspond. Le préfixe `__Secure-` en production est **hérité d'`auth.$context`, pas reproduit**. Rien n'est affaibli, rien de ce que porte le cookie n'est contrôlé par un attaquant. Une modification d'un seul caractère de la forme reproduite rougit **cinq cas** à travers le résolveur de la bibliothèque.

## Les trois constats critiques — une seule cause

`sessions.create` était une insertion Drizzle qui **contournait `databaseHooks.session.create.before`** — le garde que le fichier lui-même décrit comme « le seul endroit que tous les parcours traversent ». **Cette story était le parcours qui falsifiait cette phrase.**

**C1 — un superadmin banni se débannit lui-même.** Mesuré contre PostgreSQL, quatre gestes tous permis, tous rendant 200 : il emprunte un compte client ; un pair le bannit — `revokeAllForUser` filtre sur `user_id`, or la session empruntée porte celui de la cible ; il termine l'emprunt avec le cookie emprunté et **reçoit une session ordinaire de sept jours sur son propre compte banni** ; il se débannit.

**C2 — la durée d'une heure ne tenait pas.** La règle de rafraîchissement de la bibliothèque est **toujours vraie** pour une ligne écrite avec une expiration plus courte que la sienne. Mesuré : `expires_at` passe de `+1 h` à `+7 j` **au premier `resolveSession`**. C'est ce qui transformait la fenêtre de C1 d'une heure en une semaine.

**C3 — bannir un emprunteur laissait vivante la session qu'il tenait.** Même filtre sur `user_id`.

## Le correctif, et ce qui tient le prochain écrivain

Le refus a été déplacé **dans l'instruction** :

```sql
insert into auth_session (…) select … from auth_user
where auth_user.id = $1 and banned = false
```

Le relecteur a **imprimé le SQL généré** plutôt que de lire le code : une instruction unique, **liste de colonnes explicite** — donc indépendante de l'ordre physique —, garde dans la qualification. Aucune fenêtre entre lecture et écriture ; compte inconnu et compte banni **indiscernables**, tous deux à zéro ligne.

Et ce qui empêche le prochain de contourner n'est pas une consigne : `tests/lint-rules.test.ts` balaie le dépôt et exige que l'ensemble des écrivains de `auth_session` soit **exactement** ce fichier, plus un cas épinglant que l'insertion est un `select` portant `banned = false`. **Les deux moitiés mordent, vérifié** : un second écrivain ajouté → 1 rouge ; la clause neutralisée en gardant la forme → 2 rouges.

**C2 est fermé par restriction, pas par suppression** : la fenêtre glissante exclut désormais les sessions empruntées, et c'est **la bibliothèque elle-même** qui refuse ensuite. Témoin de restriction mesuré **dans les deux sens** — geler toutes les sessions rougit aussi.

**C3** filtre désormais `user_id` **ou** `impersonated_by`, et rend les lignes supprimées pour que le bannissement puisse journaliser les emprunts qu'il vient de clore.

## Le majeur de la ronde 2

**`isBorrowedSession` échouait ouvert, et rien ne le mesurait.** Basculer sa lecture en échec de « empruntée » à « ordinaire » laissait **la suite entière verte** — 2574 cas. Trois endroits affirmaient le contraire, dont une table dont le propos est de nommer la commande qui rougit. Le correctif de la ronde précédente avait fermé le **port** et manqué le **consommateur**.

Fermé : **0 rouge avant, 1 après**, sur la suite complète.

## Ce que l'implémenteur a trouvé au-delà du demandé

**Un quatrième décompte** que mon plan avait manqué — celui de la désignation. Le corriger transforme l'état briqué en état **auto-réparable** par `SUPERADMIN_EMAIL`.

**Et le refus d'enchaînement que j'avais imaginé n'existait pas** : une session empruntée nomme un non-superadmin, donc l'enchaînement simple est déjà impossible. Le chemin réel est que le compte emprunté soit **promu pendant l'emprunt**. Règle plus forte implémentée — *une session empruntée n'administre jamais* — et le relecteur a vérifié qu'elle tient sur **les cinq** routes d'administration.

**Deux fins d'emprunt non déclarées**, pas une : l'effacement du compte et le changement d'adresse. La purge est **nommée et non journalisée**, pour une raison qui tient : l'événement nommerait comme acteur le compte en train d'être effacé, et la cascade de clé étrangère ferme les mêmes lignes sans passer par aucun code — le journal serait émis par un chemin et pas par l'autre.

## Un fait de sécurité, concédé et écrit

**L'impersonation contourne le second facteur de la cible, par construction** : la ligne est écrite directement, aucun défi n'est émis, et le compte emprunté n'est pas là pour y répondre. Le greffon de la bibliothèque n'en fait pas plus. Écrit à trois endroits, avec sa conséquence : **le rôle de superadmin vaut le second facteur de tous les comptes du produit, c'est donc lui qu'il faut protéger.**

L'implémenteur a **refusé d'amender `docs/security.md`** depuis la story — base de cadrage, branche par défaut, frontière qu'un implémenteur ne franchit pas. La ligne y est posée séparément.

## Non vérifié

**Aucun écran** dans cette tranche — le bandeau et le back-office sont `s37b2`. **Le parcours d'impersonation n'a jamais été conduit dans un vrai navigateur** : toutes les mesures passent par le répartiteur et une relecture SQL. La combinaison `Max-Age` + `SameSite=Strict` + préfixe `__Secure-` sous HTTPS est ce qu'un `fetch` en Node ne reproduit pas.

**Un résidu latent, préexistant et non introduit ici** : `getCurrentAdapter` préfère l'adaptateur de transaction, que la copie par étalement n'enveloppe pas — un rafraîchissement exécuté dans une transaction de la bibliothèque contournerait la restriction. Le chemin de rafraîchissement n'est pas transactionnel, vérifié.

La forme de signature n'est épinglée que contre la paire installée : **une montée de version de `better-auth` doit rejouer `tests/admin.test.ts` en premier**. La concurrence est mesurée sur un seul hôte.

Max severity: major
Ship allowed: yes
