# ADR 028 — Codes de secours hachés, secret TOTP chiffré

- Status: accepted
- Date: 2026-08-31

`docs/security.md` demandait « secrets de second facteur et codes de secours stockés hachés ». La phrase mélangeait deux objets : le secret TOTP est réversible par construction (vérifier un code exige de le regénérer), alors que les codes de secours sont des mots de passe à usage unique, comparables à une saisie. Better Auth range ces derniers **chiffrés** par défaut : qui lit la base et connaît `AUTH_SECRET` retrouve dix moyens de contourner le second facteur.

**Les codes de secours sont stockés hachés** — HMAC-SHA256 poivré par le secret de l'application, préfixé `sha256:` (`domain/backup-code.ts` du module `auth`). `storeBackupCodes` reçoit un couple `{encrypt, decrypt}` dont `encrypt` remplace chaque code par son empreinte, et la route du module hache la saisie avant de la transmettre, si bien que la bibliothèque compare empreinte contre empreinte. Les deux chemins restent séparés : côté magasin, une valeur déjà empreinte passe inchangée (la bibliothèque rappelle l'encodeur avec le reste du tableau après chaque consommation) ; côté saisie, `digestBackupCode` hache sans condition. Les fusionner rend la base plus faible que le défaut : une empreinte volée, postée telle quelle, ouvrirait une session sans même `AUTH_SECRET`.

**Le secret TOTP est chiffré au repos** et n'est exposé qu'une fois, dans la réponse à `POST /two-factor/enable`. `/two-factor/get-totp-uri` n'est pas déclaré par le module.

## Considered options

- **Réécrire les codes de secours dans le module** (table dédiée, `delete … returning`) — rejeté : consommer un code termine une connexion, il faudrait donc réécrire aussi la session, le cookie signé et le défi, que le module confie délibérément à la bibliothèque. À rouvrir si elle cessait d'exposer `storeBackupCodes`.
- **Remplacer « hachés » par « protégés » dans le socle** — rejeté : « protégé » ne nomme aucune propriété vérifiable.

## Consequences

Le montage dépend de trois faits du paquet installé, à revérifier à chaque montée de version : `storeBackupCodes` accepte `{encrypt, decrypt}` ; l'encodeur est rappelé avec le tableau déjà encodé ; les codes émis (`XXXXX-XXXXX`) ne peuvent pas être confondus avec `sha256:<64 hex>`. Le test « les neuf autres codes fonctionnent encore » rougit si l'un change.

Deux écarts de la bibliothèque sont refermés dans le module. La consommation d'un code de secours n'est pas atomique sur PostgreSQL (l'adaptateur Drizzle place la garde dans un sous-select, que la réévaluation ne refait pas) : `infrastructure/two-factor-adapter.ts` la remplace par un `UPDATE … WHERE id = ? AND backup_codes = ?`. Un code TOTP accepté restait rejouable pendant sa fenêtre : `auth_two_factor.last_totp_step` retient le dernier pas consommé, pris par comparaison-et-échange, calculé par la primitive HOTP de la bibliothèque elle-même (`@better-auth/utils`, en dépendance directe à la version qu'épingle `better-auth`) — une seconde implémentation pourrait diverger et refuser toutes les connexions.
