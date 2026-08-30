# Research — Story s07-signup-signin

## The five structuring facts

1. **C'est le second module du socle non désactivable**, et le premier qui touche à la sécurité des comptes. `AGENTS.md` le dit : sans compte, il n'y a pas de SaaS. Il n'a donc pas de critère « module non activé ». Il **consomme** le port `Mailer` posé par s06 — c'est le premier consommateur réel de ce port, et le premier email qu'un utilisateur reçoit vraiment.
2. **Better Auth 1.7.2** est la solution pressentie par le PRD (ADR 004). Elle fournit nativement mot de passe, magic link, vérification, réinitialisation et sessions ; les plugins `organization`, `admin`, `two-factor` et `passkey` couvrent s13 à s17 et s37. **Le schéma des tables d'authentification est généré par Better Auth** et doit être intégré au schéma Drizzle du module — c'est le premier module qui déclare de vraies tables métier, donc le premier vrai test du baril de s04.
3. **Le socle de sécurité §2 s'applique en entier**, et il est plus exigeant que les critères d'origine de la story : rotation de l'identifiant de session à chaque élévation de privilège, révocation effective côté serveur, révocation des autres sessions au changement de mot de passe ou d'email, jetons à usage unique avec invalidation des frères, verrouillage progressif par compte **et** par IP, messages indistinguables — **y compris en temps de réponse**.
4. **L'égalité des temps de réponse est le critère le plus facile à rater.** Un « compte inconnu » qui répond avant d'avoir haché un mot de passe est distinguable au chronomètre, même si le message est identique. Better Auth peut le gérer, ou pas : à vérifier dans le paquet installé, et à prouver par une mesure, pas par une lecture.
5. **Le contrat de module impose de déclarer les emails avec leurs locales**, et `assertDeclarationsAreComplete` le vérifie. Le module `auth` déclarera vérification, magic link et réinitialisation — trois templates, chacun dans chaque locale livrée. C'est le premier module à exercer réellement cette contrainte.

## Target story

`s07-signup-signin` — complexité 3, dépend de s06. Treize critères après amendement par le socle de sécurité : inscription et email de vérification ; blocage des routes protégées tant que non vérifié ; lien de vérification, expiré ou consommé traité explicitement ; magic link à usage unique ; message d'erreur générique identique ; réinitialisation invalidant les liens frères ; déconnexion révoquant la session ; redirection puis retour à l'URL demandée ; **rotation de session à l'élévation de privilège** ; **cookie `HttpOnly`, `Secure`, `SameSite`, jamais lisible par le JavaScript client** ; **changement de mot de passe ou d'email révoquant les autres sessions, vérifié côté serveur** ; **événements de sécurité journalisés sans secret** ; **temps de réponse indistinguable**.

## Current state of the code

s01 à s06 livrées : contrat de module et registre, migrations par module avec baril généré, CLI de bascule, port `Mailer` et adapter Resend, capture locale explicite, lint de couches et pureté du `domain`, trois socles transverses. 355 tests. `apps/web` sert une page nue et `/api/health` ; **aucune notion d'utilisateur n'existe**.

Les modules de démonstration ont des repositories **en mémoire** : `auth` sera le premier module à persister réellement, donc le premier à rencontrer le résidu documenté en s04 — `enabledModuleSchemas = []`, donc `createDatabaseClient` construit Drizzle avec un schéma relationnel vide et `db.query.<table>` est indisponible. **C'est cette story qui doit le résoudre**, et le baril de s04 est déjà l'endroit qui sait le faire à la génération.

## Anchor points

| À créer | Rôle |
|---|---|
| `packages/modules/auth/` | Le module, ses quatre couches, son `AGENTS.md` |
| Schéma Drizzle des tables Better Auth | Intégré au module, migrations générées par s04 |
| Trois templates d'email | Vérification, magic link, réinitialisation, dans chaque locale |
| Écrans d'authentification | Inscription, connexion, mot de passe oublié, vérification |
| Résolution de session | Le `resolveSession` que s03 attend et qu'`apps/web` ne fournit pas encore |

**Point structurel** : s03 a livré un `resolveSession` en forme de crochet non fourni, si bien que toute route non publique répond 401 aujourd'hui. C'est le comportement fermé par défaut voulu — s07 est la story qui le branche.

## Verified APIs / functions

`better-auth` et `@better-auth/passkey` sont en **1.7.2**. À vérifier **dans le paquet installé**, jamais depuis la documentation en ligne — c'est le piège qui a coûté un tour à s01, deux à s05 et deux à s06 :

- la forme exacte de la configuration `betterAuth({...})` et de son adaptateur Drizzle ;
- la génération du schéma : commande, sortie, et **comment l'intégrer à un schéma de module** plutôt qu'à un schéma global ;
- si la bibliothèque égalise les temps de réponse sur compte inconnu, et si elle expose la rotation de session ;
- la forme de ses hooks d'envoi d'email, pour les brancher sur le port `Mailer` et non sur un client SMTP interne.

## Traps & constraints

- **Ne pas laisser Better Auth parler directement à un fournisseur d'email.** Ses hooks doivent appeler le port `Mailer` de s06 ; sinon le dépôt a deux chemins d'envoi et le §5 du socle devient invérifiable.
- **Le schéma généré doit vivre dans le module**, pas à la racine. Sinon s04 est contourné et la promesse « aucune table d'un module non activé » tombe pour le module le plus important.
- **`domain` ne connaît ni Better Auth ni Drizzle** — le lint le vérifie depuis s02, et la liste de refus a été étendue en s06.
- **Aucun secret dans un journal** : ni jeton, ni mot de passe, ni cookie de session. Le filtrage se prouve **par mutation**.
- **Le temps de réponse** est un critère mesurable : il demande un test qui chronomètre, pas une lecture de code.
- **Le résidu `enabledModuleSchemas = []`** doit être résolu ici, sinon le module ne peut pas lire ses propres tables par l'API relationnelle.

## Open questions

1. **Où vit la configuration Better Auth ?** Dans le module `auth`, ou au point de composition d'`apps/web` comme le mailer ? Le module doit rester désactivable en théorie — mais il est socle, donc la question est de forme, pas de fond.
2. **Comment brancher `resolveSession` du registre** sans que `packages/core` dépende du module `auth` ? C'est une inversion à trancher au plan.
3. **La rotation de session est-elle native ?** Si Better Auth ne la fournit pas, elle doit être écrite et testée explicitement.

## Real complexity

**Verdict : 4**, contre 3 annoncé. Le score de 3 datait d'avant l'amendement par le socle de sécurité, qui a ajouté cinq critères dont deux non triviaux — la rotation de session à chaque élévation de privilège, et l'égalité des temps de réponse qui exige une mesure. S'y ajoutent trois premières fois : premier module à persister réellement, premier consommateur du port `Mailer`, premier à brancher `resolveSession`. Aucune n'est difficile isolément ; leur conjonction sur la story la plus sensible du socle justifie le 4.

Pas de découpage proposé : le verdict n'est pas 5, et découper l'authentification laisserait le dépôt avec une moitié de parcours de connexion, ce qui n'est pas livrable.
