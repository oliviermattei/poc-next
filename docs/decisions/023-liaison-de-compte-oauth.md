# ADR 023 — La liaison d'un compte OAuth exige une double preuve d'adresse

- Status: accepted
- Date: 2026-08-31
- Scope: story s12-oauth-signin

## Context
Une connexion par fournisseur externe présente une adresse email et affirme, ou non, qu'elle appartient bien à celui qui se connecte. Le produit doit décider ce qu'il fait quand cette adresse correspond **déjà** à un compte local. Trois issues sont possibles : ouvrir la session du compte existant (liaison), créer un second compte sur la même adresse, ou refuser.

La faille classique est la première, faite sans preuve : un attaquant inscrit `victime@exemple.test` avec un mot de passe, ne vérifie jamais l'adresse, attend. La victime — qui possède réellement cette adresse chez Google — se connecte par le bouton, le fournisseur atteste son adresse, la bibliothèque rapproche les deux comptes, et la victime entre dans un compte que l'attaquant contrôle aussi, par son mot de passe. C'est le *pre-hijacking* : rien ne s'y voit, personne n'y est prévenu.

Le miroir est aussi vrai : un fournisseur qui **ne garantit pas** l'adresse ne prouve rien. Chez GitHub, une adresse non vérifiée reste visible dans le profil ; s'en contenter revient à laisser n'importe qui écrire l'adresse d'un tiers chez le fournisseur et venir la réclamer ici.

`better-auth@1.7.2` fournit les deux moitiés du contrôle (`accountLinking.trustedProviders`, `accountLinking.requireLocalEmailVerified`), avec des valeurs par défaut qui coïncident aujourd'hui avec ce que nous voulons. **Un défaut qu'aucun test ne tient est un défaut qui change à la prochaine montée de version**, et le dépôt s'est déjà fait prendre par une règle vraie « par hasard ».

## Decision
**Une identité de fournisseur ne rejoint un compte local que si l'adresse est attestée deux fois : par le fournisseur, et par le compte local.**

Trois conséquences, écrites et éprouvées :

1. **Le fournisseur doit attester l'adresse.** Un crochet unique (`user.validateUserInfo`) refuse toute identité OAuth dont l'adresse n'est pas attestée, sur les **trois** actions que la bibliothèque distingue — création, liaison, retour d'un compte déjà lié. La règle vit dans le `domain` du module (`oauthProvisioningRefusal`) et n'est écrite qu'une fois. Le refus à la **création** est le moins évident et le plus utile : sans lui la bibliothèque crée la ligne `auth_user` puis refuse la session, et l'adresse d'un tiers reste squattée par un compte que personne ne contrôle.
2. **Le compte local doit être vérifié.** `accountLinking.requireLocalEmailVerified` reste à `true`, écrit explicitement. Un compte mot de passe non vérifié ne capte donc aucune identité de fournisseur : le pré-enregistrement ne donne rien. Le propriétaire réel de l'adresse reprend son compte par le parcours de vérification ou de réinitialisation — il possède la boîte.
3. **Aucun fournisseur n'est cru sur parole.** `trustedProviders` reste vide, et `allowDifferentEmails` reste faux : une liaison ne rapproche que deux fois la **même** adresse, attestée.

**Le refus ne dit pas pourquoi.** Le code de la bibliothèque (`account_not_linked`, `email_not_found`…) s'arrête à une route de normalisation du module, qui ne laisse sortir que deux classes : « vous avez refusé l'autorisation » et « connexion impossible ». Un message — ou une URL — qui distinguerait « un compte existe à cette adresse » serait une énumération de comptes depuis une page publique (`docs/security.md` §7).

## Considered options
- **Lier dès que les adresses correspondent** (le défaut historique de plusieurs bibliothèques) — rejeté : c'est exactement la prise de contrôle décrite ci-dessus. Le confort — « ça marche du premier coup » — se paie d'un compte volé silencieusement.
- **Créer un second compte sur la même adresse** — rejeté : la table impose l'unicité de l'adresse (s07), et la lever produirait deux comptes indiscernables pour l'utilisateur comme pour les emails transactionnels. « Quel est mon compte ? » n'a alors plus de réponse.
- **Faire confiance à Google et GitHub par `trustedProviders`** — rejeté : la confiance porterait sur le **fournisseur**, pas sur l'attestation. Google et GitHub *savent* dire si une adresse est vérifiée ; les inscrire dans la liste revient à ne plus le leur demander, et à accepter aussi leurs adresses non vérifiées. Le contrôle est gratuit, la confiance ne l'est pas.
- **Ne pas exiger que le compte local soit vérifié** (`requireLocalEmailVerified: false`) — rejeté : c'est précisément la porte du pré-enregistrement. La contrepartie est assumée : un utilisateur inscrit et jamais vérifié qui essaie le bouton se voit refuser, et doit d'abord vérifier son adresse. Le parcours de renvoi de vérification existe depuis s07 et répond la même chose que l'adresse existe ou non.
- **Demander une confirmation à l'utilisateur (« un compte existe, voulez-vous le lier ? »)** — rejeté pour cette story : la question elle-même est un oracle d'énumération, posée à un visiteur non authentifié. La liaison explicite depuis les paramètres du compte (`/link-social`, déjà authentifiée) est la bonne forme, et elle n'est pas dans le périmètre de s12.
- **S'en remettre aux défauts de la bibliothèque** — rejeté : ils sont bons aujourd'hui, et `requireLocalEmailVerified` y est même annoncé comme bientôt inconditionnel. Mais un défaut n'est pas une décision, et le seul moyen de le savoir cassé est de l'avoir écrit et éprouvé.

## Consequences
Facilité : la story qui ajoute un fournisseur (Apple, Microsoft) hérite de la règle sans y toucher — elle est au crochet, pas au fournisseur. s13 (2FA), s14 (passkeys) et s16 (invitations) héritent du même principe : une adresse ne prouve la propriété d'un compte que si deux parties l'attestent.

Difficulté : un utilisateur dont le compte mot de passe n'est pas vérifié se voit refuser la connexion par fournisseur, avec un message générique qui ne lui dit pas pourquoi. C'est le prix de l'absence d'oracle, et le chemin de sortie existe : vérifier son adresse, ou réinitialiser son mot de passe.

À surveiller : les deux lignes de configuration `trustedProviders: []` et `allowDifferentEmails: false` **ne font rougir aucun cas à elles seules** — mesuré, mutation par mutation. Les raisons sont **deux, et différentes** ; les confondre trompe le prochain lecteur, et c'est ce que disait la première version de ce paragraphe.

- **`trustedProviders: []` est un filet réellement indépendant du crochet, et il s'évalue *avant* lui.** Dans `oauth2/link-account.mjs` du paquet installé (1.7.2), la porte `!isTrustedProvider && !userInfo.emailVerified || requireLocalEmailVerified && !dbUser.user.emailVerified || …` est ligne ~83 ; `assertValidUserInfo` — donc le crochet `user.validateUserInfo` — est ligne ~92. Le crochet refuse donc **plus tard**, pas plus tôt. Neutraliser l'un laisse l'autre tenir le cas « compte local vérifié + fournisseur qui n'atteste pas » (deux mutations, zéro rouge chacune) ; neutraliser **les deux ensemble** fait rougir 2 cas. La couverture est donc double, et elle est mesurée.
- **`allowDifferentEmails: false` n'est lu par aucun chemin que ce module déclare.** Les deux seules lectures sont `api/routes/callback.mjs:177` (branche `link` de l'état) et `api/routes/account.mjs:213` (`/link-social`) : toutes deux appartiennent au parcours de **liaison explicite**, que s12 ne déclare pas — donc 404. La mutation est verte parce que le chemin est **injoignable**, pas parce qu'un crochet l'a devancée : le crochet ne voit jamais ce cas. La ligne reste écrite comme interdit lisible, en prévision de la story qui déclarera `/link-social` — c'est elle qui devra la couvrir par un test, pas la supposer tenue.

> **Correction en place, et pourquoi.** Un ADR accepté est immuable *quant à sa décision*. La décision — la double preuve — n'a pas changé d'un mot. Ce qui précède corrige une **affirmation de fait** sur le mécanisme de la bibliothèque, mesurée fausse en revue de s12 : la superséder par un nouvel ADR laisserait la version fausse comme référence courante d'une décision qui, elle, reste valide. Une erreur de fait est un défaut, pas un changement de décision.
