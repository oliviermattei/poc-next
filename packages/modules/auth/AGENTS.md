# packages/modules/auth — règles locales

Le module d'authentification : inscription, vérification d'email, connexion par
mot de passe, magic link, réinitialisation, sessions.

**Socle non désactivable.** Sans compte, il n'y a pas de SaaS : les invitations,
le guest checkout, la suppression de compte et l'export en dépendent. Il n'a
donc **pas** de critère « module non activé » — `config/features.ts` le nomme
dans `requiredModules`, et la validation de la configuration **refuse** un
`enabledModules` qui ne le contient pas, au démarrage comme dans `ks toggle`
(ADR 021). Ce n'est pas la validation des `requires` qui l'empêche : aucun
module ne requiert `auth`, et c'est précisément pourquoi la règle a dû devenir
exécutable. Cette différence est la seule ; pour tout le reste, c'est un module
comme un autre, avec le contrat complet, ses quatre couches et ses migrations à
lui.

## La frontière avec Better Auth

C'est le seul sujet de ce package. Une bibliothèque d'authentification veut
posséder quatre choses ; chacune a déjà un propriétaire ici :

| Ce qu'elle veut posséder | Qui le possède | Ce qui échoue si on le lui rend |
|---|---|---|
| le schéma | `src/schema.ts`, généré par le baril de s04 | `tests/auth.test.ts` compare les tables créées sur base vierge à celles que le module déclare, et les champs attendus par `getAuthTables()` aux propriétés Drizzle |
| les emails | le port `Mailer` (s06), par `src/application/auth-use-cases.ts` | le même fichier vérifie qu'aucun appel réseau ne sort pendant les parcours : un envoi hors du port s'y verrait |
| les routes | le registre, par `src/presentation/auth-routes.ts` | une route non déclarée répond 404 sans atteindre la bibliothèque |
| la session | `resolveSession` du répartiteur | les attributs du cookie, la rotation et la révocation sont mesurés, pas relus |

Deux conséquences qu'il ne faut pas défaire :

- **la vérification d'email est à nous.** Le jeton de la bibliothèque est un JWT
  signé, ni stocké ni consommable : un lien déjà utilisé y répond « c'est bon »
  au lieu de « ce lien a déjà servi », et rien ne l'invalide avant son
  expiration. `emailVerification.sendVerificationEmail` reste donc **absent** de
  la configuration, et le parcours passe par le magasin de jetons à usage unique
  du module ;
- **l'envoi de l'email de réinitialisation est différé.**
  `advanced.backgroundTasks.handler` est branché sur `runInBackground` ; sans
  lui, `runInBackgroundOrAwait` **attend** la promesse, donc seul un compte
  existant paie l'appel au fournisseur et l'existence du compte se lit au
  chronomètre — mesuré à 119 ms d'écart sur un mailer à 120 ms. Le point de
  composition de l'application y branche le `after` de Next, pour que le travail
  survive à la réponse ;
- **`change-password` ne transmet pas le corps du client.** `revokeOtherSessions`
  y est imposé : laisser le client le fournir reviendrait à lui laisser décider
  si ses autres sessions survivent à un changement de mot de passe.

## Ce que la bibliothèque fait déjà bien, et qu'il ne faut pas réécrire

Mesuré dans le paquet **installé** (1.7.2), sur les quatre points regardés :
`sign-in/email` hache un mot de passe factice quand le compte est inconnu (d'où
l'égalité des temps de réponse — et elle ne vérifie l'adresse qu'**après** le
mot de passe, donc son `403` n'était atteignable qu'en connaissant déjà celui-ci),
`consumeVerificationValue` consomme une ligne
de vérification en transaction, `revokeSessionsOnPasswordReset` supprime les
sessions à la réinitialisation, et un magic link résolvant un compte non vérifié
efface les identifiants accumulés avant la preuve. Ce sont les cas examinés, pas
un inventaire de ce que la bibliothèque garantit.

## Imports autorisés

- `@repo/core` pour le contrat de module, le préfixe de montage et la session ;
- `@repo/ports` pour le port `Mailer` — jamais un client d'email ;
- `better-auth` dans `infrastructure/` **uniquement** ;
- `drizzle-orm` dans `src/schema.ts` et dans `infrastructure/` uniquement ;
- `zod` pour la validation, y compris dans `domain/` où c'est la seule
  bibliothèque tierce admise ;
- `node:crypto` dans `infrastructure/` pour les jetons ;
- `@repo/typescript-config` pour la configuration du compilateur ;
- `vitest` dans les fichiers de test.

Sens des dépendances, vérifié par `pnpm lint` :
`presentation → application → domain` et `infrastructure → application →
domain`. `infrastructure` et `presentation` ne se connaissent pas — c'est
pourquoi le service de la bibliothèque est déclaré comme un **port** dans
`application/auth-service.ts` et implémenté dans `infrastructure/`.

## Ne doit jamais contenir

- **d'import de `@repo/db`** : la connexion est **injectée** par le point de
  composition. L'agrégat de schémas généré importe ce package ; la dépendance
  inverse fermerait un cycle, et une table serait lue avant d'être initialisée
  (ADR 020). `tests/module-registry.test.ts` le refuse ;
- de client d'email, de SMTP, de fournisseur : le port `Mailer` est le seul
  chemin d'envoi. Un second chemin rendrait le §5 du socle invérifiable ;
- de secret dans un journal : ni jeton, ni mot de passe, ni cookie. La forme de
  `SecurityEventRecord` est fermée, et les valeurs sont filtrées ;
- de réponse publique qui distingue **un état de compte d'un autre**, ni par le
  texte, ni par le code de statut, ni par le temps de réponse. Les états sont
  au moins au nombre de trois — compte inconnu, mot de passe faux, adresse non
  vérifiée — et la liste n'est pas close : la règle porte sur la distinction,
  pas sur ce triplet. C'est `SIGN_IN_REFUSAL` du `domain` qui la tient, et la
  route de connexion réécrit par-dessus la réponse de la bibliothèque, qui
  rend `403 EMAIL_NOT_VERIFIED` là où elle rend `401` pour les deux autres. Le
  critère « inviter à vérifier son adresse » est tenu **ailleurs** : sur
  `/verify-email` et par une invitation constante dans le refus, jamais par un
  refus qui varie ;
- de constante de politique en dur : longueurs de mot de passe et durées de vie
  des liens vivent dans `AuthPolicy`, injectée au point de composition ;
- d'OAuth, de second facteur ni de passkey : ce sont s12, s13 et s14. Les
  greffons peuvent être prévus, pas activés.

## Tests

- `src/domain/auth-rules.test.ts` : les règles pures, éprouvées là où elles
  vivent — identifiants, destination de retour, session dérivée du compte,
  filtrage du journal, jetons. Leurs appelants prouvent qu'ils les appellent,
  ils ne rejouent pas ces matrices ;
- `tests/auth.test.ts` à la racine : tout ce qui traverse — base réelle,
  répartiteur, port `Mailer`, cookie, temps de réponse. C'est là que vivent les
  trois mesures de frontière ;
- `e2e/auth.spec.ts` : le parcours complet dans un navigateur.
