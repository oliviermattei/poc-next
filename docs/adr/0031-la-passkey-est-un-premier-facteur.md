# ADR 031 — Une passkey est un premier facteur, pas une authentification à deux facteurs

- Status: accepted
- Date: 2026-09-01

Le W3C et la FIDO Alliance présentent une passkey avec vérification de l'utilisateur (`UV`) comme deux facteurs, et plusieurs produits en dispensent le second facteur. Mais `@better-auth/passkey` vérifie l'enregistrement et l'authentification avec `requireUserVerification: false`, écrit en dur et sans option : le drapeau `UV` est écrit par l'authentificateur et jamais exigé par le serveur. Dans ce montage, une passkey prouve la possession d'un authentificateur, rien de plus.

**Une passkey est un premier facteur.** `/passkey/verify-authentication` n'est pas exempté du crochet du second facteur : un compte à second facteur actif qui se connecte par passkey est renvoyé à l'écran de vérification, comme après un mot de passe, un magic link ou un fournisseur OAuth. La garde vaut partout sauf sur les chemins exemptés, énumérés avec leur raison dans `TWO_FACTOR_CHALLENGE_EXEMPT_PATHS` (`packages/modules/auth/src/infrastructure/two-factor-challenge.ts`) ; une exemption ne s'ajoute que si retirer le chemin fait rougir le cas qui la justifie. `/passkey/verify-registration` y figure : il fait tourner la session d'un appelant déjà authentifié et ne peut ouvrir aucune session.

## Considered options

- **Exempter la passkey du second facteur** — rejeté : le drapeau qui le justifierait n'est pas vérifié, et l'échec serait *ouvert* — une session sans second facteur, en silence — là où ne pas exempter échoue *fermé*, au pire un défi de trop, visible.
- **Ouvrir la session puis exiger le code en aval** — rejeté : la branche « session déjà ouverte » de la vérification du second facteur n'arme ni compteur de tentatives ni verrouillage ; ce serait une devinette à six chiffres sans limite.
- **Relire `userVerified` dans `authentication.afterVerification`** — rejeté : la session est déjà créée quand le crochet s'exécute, et le drapeau reste une déclaration du client, pas une preuve.

## Consequences

Un compte protégé par un second facteur et muni d'une passkey présente deux preuves à chaque connexion.

Si `@better-auth/passkey` se met à exiger `UV`, la question se rouvre par une nouvelle ADR, pas par une ligne ajoutée aux exemptions.

Le `rpID` est l'hôte d'`APP_URL`, scellé dans le justificatif à l'enrôlement : **changer l'hôte d'`APP_URL` invalide toutes les passkeys enregistrées**, sans message ni migration possible. Le mode d'emploi d'un changement de domaine vit dans `packages/modules/auth/AGENTS.md`.
