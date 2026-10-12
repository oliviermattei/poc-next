# ADR 026 — Le jeton d'invitation autorise une organisation, et l'acceptation ne fait pas tourner l'identifiant de session

- Status: accepted
- Date: 2026-08-31
- Scope: story s16-invite-members
- Amendé le 2026-08-31, au tour de correction de la même story et **avant tout
  ship** : la course du dernier propriétaire est fermée plutôt que surveillée,
  le quota compte le renvoi, et l'argument de fixation de session est écrit.
  Un ADR livré serait superséqué, pas récrit — celui-ci n'a jamais été mis en
  production.

## Context

s16 fait entrer un second secret dans le produit, après le cookie de session :
le **lien d'invitation**. Trois questions se posent ensemble, et les traiter
séparément produirait trois demi-réponses.

**1. Où vit le jeton.** Le module `auth` possède déjà une table de jetons à usage
unique (`auth_verification`) et une fabrique
(`packages/modules/auth/src/infrastructure/token-factory.ts`). L'y ranger
coûterait à `auth` une donnée d'organisation — exactement ce que l'ADR 025 vient
de refuser pour la session, et ce que `packages/db/src/references.ts` refuse
déjà.

**2. Comment il meurt.** `docs/security.md` §2 exige d'un jeton à usage unique
« durée de vie courte, **consommation atomique**, invalidation des jetons frères
à l'usage ». Le critère 3 de la story exige en plus de **distinguer** expirée,
révoquée et déjà acceptée — donc de ne pas effacer la ligne à la consommation.

**3. Si l'identifiant de session doit tourner.** Accepter une invitation ajoute
un droit, et `docs/security.md` §2 impose « rotation de l'identifiant de session
à l'élévation de privilège ». La phrase énumère trois cas : **connexion,
validation du second facteur, fin d'impersonation**. L'ADR 025 a déjà tranché que
la bascule d'organisation n'en est pas une, parce que le jeton de session ne
porte aucune autorité organisationnelle. L'acceptation ressemble davantage à une
élévation, et la question méritait d'être réattaquée plutôt que déduite.

Trois mesures faites dans le code, avant de décider :

- `ModuleSession` (`packages/core/src/module.ts`) porte `userId` et `roles`, et
  rien d'autre ;
- `auth_session` n'a **aucune** colonne d'organisation sur une base fraîchement
  migrée (plugin `organization` non monté, ADR 025) ;
- `AuthService` (`packages/modules/auth/src/application/auth-service.ts`) expose
  `handle`, `handleOAuthCallback`, `changePassword`, `resolveSession`,
  `resolveSessionId`, `localeOf`, `oauthProviders`, `useCases`, `policy`. **Aucune
  rotation.** Un balayage de `packages/modules/auth/src` ne trouve que
  `revokeForUser` et le drapeau `revokeOtherSessions` imposé au changement de mot
  de passe.

## Decision

**Le module `organizations` émet son propre jeton**, dans sa table
`organization_invitation` : 32 octets du générateur cryptographique du système,
stockés en **empreinte SHA-256**. Le secret en clair n'existe que dans le lien
envoyé.

**La consommation est un seul ordre conditionnel**
(`update … where token_hash = ? and email = ? and accepted_at is null and
revoked_at is null and expires_at > now() returning …`), suivi de l'écriture de
l'appartenance en `onConflictDoNothing`. La ligne **survit** à sa consommation :
c'est elle qui permet de dire « expirée », « révoquée » ou « déjà acceptée ».
L'adresse du destinataire est **dans le prédicat** — faire suivre l'email ne
donne donc pas l'accès à qui le reçoit.

**Une émission d'invitation est une ligne**, et le quota compte les lignes de la
fenêtre. Le renvoi ne réécrit donc pas la ligne existante : il l'**éteint** — il
la révoque et remplace son empreinte par celle d'un jeton que personne n'a reçu,
si bien que l'ancien lien ne désigne plus rien — et en écrit une neuve, datée de
l'horloge du module. C'est ce qui rend le quota conforme à ce qu'il annonce :
tant que le renvoi réécrivait la même ligne, il n'était compté par rien, et
cinquante renvois consécutifs envoyaient cinquante emails sans un seul refus
(revue de s16, F2). L'invitation et le renvoi passent par la **même** fonction de
quota ; une seule invitation vivante subsiste par adresse, ce que l'index unique
partiel impose de toute façon.

**L'acceptation ne fait pas tourner l'identifiant de session.** Le jeu de droits
attaché à une session est relu à chaque requête, dans le prédicat de la lecture ;
il n'y a rien à faire tourner. La propriété opposable est la **réciproque**, et
elle est mesurée : la **même** session perd l'accès à l'instant où la ligne
d'appartenance disparaît, sans reconnexion
(`tests/organizations.test.ts`, « fait perdre l'accès immédiatement, à la même
session »).

## Considered options

- **Ranger le jeton dans `auth_verification`, avec un `TokenPurpose`
  supplémentaire** — rejeté : une table du module `auth` porterait une donnée
  d'organisation, elle survivrait à la coupure du module `organizations`, et
  `packages/db/src/references.ts` refuse déjà qu'une table appartienne à deux
  modules. C'est le raisonnement de l'ADR 025, appliqué au jeton.
- **Signer le jeton plutôt que le stocker** (JWT, HMAC) — rejeté : un jeton signé
  n'est pas révocable et n'est pas à usage unique. C'est exactement ce que la
  revue de s07 a relevé — un jeton signé jamais stocké est rejouable jusqu'à son
  échéance —, et le critère 5 demande une révocation immédiate.
- **Effacer l'empreinte à la consommation** — rejeté : rend « déjà acceptée »
  indiscernable de « lien inconnu », alors que le critère 3 exige une erreur
  **explicite**. L'empreinte conservée n'ouvre rien : la ligne ne satisfait plus
  le prédicat de consommation, et l'empreinte est un SHA-256 de 256 bits
  d'entropie.
- **Ne pas lier le jeton à l'adresse** (« qui tient le lien entre ») — rejeté :
  c'est le modèle le plus répandu, et le plus fragile. Un email transféré, une
  archive de boîte partagée, un moteur d'aperçu de lien deviennent des voies
  d'accès. Le coût assumé est réel et il est écrit : un invité qui a un compte
  sous une **autre** adresse doit se faire réinviter.
- **Accepter en `GET`, depuis le lien** — rejeté, et c'est le piège le plus
  probable : un client de messagerie, un antivirus ou un proxy suit les `GET` et
  consommerait le jeton avant l'invité. L'acceptation est une soumission ; le
  lien mène à un écran qui la propose.
- **Faire tourner l'identifiant de session à l'acceptation** — rejeté ici, et
  c'est la décision la plus discutable de cet ADR, donc la plus argumentée.
  L'obtenir demanderait d'ouvrir un point d'entrée de rotation dans le module
  `auth`, qui n'en a aucun ; cette voie a pour consigne explicite de ne pas
  prendre ce point d'entrée mais de le **nommer**. Sur le fond, la rotation
  protège contre la **fixation de session** — un identifiant obtenu avant
  l'élévation et rejoué après. Ici l'identifiant ne gagne rien qu'il ne perde
  aussitôt : l'appartenance est relue à chaque requête, et son retrait est
  immédiat pour la même session. Une rotation ajouterait un rite sans changer un
  droit.
  **L'argument le plus solide n'était pas écrit ici, et la revue l'a nommé** :
  la fixation de session est fermée **par ailleurs**, structurellement.
  L'attaque que la rotation prévient consiste à faire élever une session que
  l'attaquant contrôle — il implante son propre identifiant de session chez la
  victime, puis attend qu'elle gagne un droit. Ici, cela ne produit rien :
  l'**adresse du destinataire est dans le prédicat de la consommation**, si bien
  qu'une session implantée — dont le compte porte l'adresse de l'attaquant — ne
  consomme aucune invitation. Ce n'est pas une atténuation : c'est la même
  propriété qui rend le lien non transférable, et elle est éprouvée par mutation
  (retirer `email = ?` fait rougir « refuse un lien émis pour une autre
  adresse »).
  **À rouvrir** si l'un de ces trois faits cesse d'être vrai : `ModuleSession`
  se met à porter une autorité organisationnelle ; une lecture met l'appartenance
  en cache ; ou le module `auth` expose une rotation, auquel cas l'appliquer ne
  coûte plus rien et la défense en profondeur vaut son prix.
- **Un port de limitation de débit pour l'émission d'invitations** — rejeté :
  `docs/architecture.md` reporte explicitement la limitation de débit à s28, et
  pour un point d'entrée **public** ; la route d'invitation est `authenticated`.
  Ce qui est posé à la place est un **quota d'émission par organisation**
  (20 par heure), compté dans la table des invitations — donc partagé entre
  instances, sans nouvelle table ni nouvelle dépendance. Ce n'est pas la même
  chose, et l'appeler « rate limiting » ferait croire s28 faite.

## Consequences

**Plus facile.** Le module reste séparable : couper `organizations` ne laisse
aucune trace dans `auth`. Le jeton est révocable, renouvelable et lié à une
adresse — trois propriétés qu'un jeton signé n'a pas. Le refus est explicite dans
les cinq cas que l'écran d'acceptation connaît.

**Plus difficile.** Un invité dont le compte porte une autre adresse que celle
invitée doit être réinvité : c'est le prix de la non-transférabilité, et le
message le dit (`error.invitation_other_recipient`). Le renvoi éteint
l'invitation précédente et en émet une neuve : un ancien lien encore ouvert dans
un onglet cesse de fonctionner sans prévenir, et répond « lien inconnu » —
l'empreinte de la ligne éteinte a été remplacée. L'**identifiant** de
l'invitation change donc à chaque renvoi : un écran resté ouvert qui reposte
l'ancien identifiant reçoit le même « lien inconnu », plutôt que d'agir sur une
invitation qu'il croyait désigner.

**À surveiller — ce que le quota ne tient pas.** Le comptage précède l'écriture :
deux requêtes concurrentes peuvent chacune franchir le seuil. Le dépassement est
borné par la concurrence, pas par le temps (mesuré : 21 lignes écrites pour un
quota de 20, avec six requêtes parallèles). Ce qui, en revanche, **est** tenu
depuis le tour de correction : le renvoi compte dans la fenêtre — voir ci-dessus.

**La règle du dernier propriétaire sous concurrence — fermée au tour de
correction.** Ce paragraphe annonçait la course comme un risque résiduel, en
s'appuyant sur un argument qui ne tenait pas : « la fermer demanderait un verrou
de ligne, donc une lecture dans le chemin d'écriture, que la porte de lecture du
module refuse ». Deux choses étaient fausses.

D'abord la mesure : la revue a exercé la course, et ce n'est pas un cas rare —
**23 courses sur 25** entre deux propriétaires laissaient l'organisation sans
propriétaire, et **16 sur 20** y parvenaient depuis une **seule** session, par
deux soumissions parallèles de l'écran ; 15 fois sur 20 il ne restait aucun
membre. Aucune route de s16 ne promeut qui que ce soit : l'état est
irrécupérable dans le produit.

Ensuite l'argument : la porte de lecture est une contrainte que le module s'est
donnée à lui-même, et elle ne peut pas primer sur un critère d'acceptation
(« le dernier propriétaire d'une organisation ne peut pas être retiré »). Elle
n'avait même pas à céder : `pg_advisory_xact_lock` **ne lit aucune table**. Le
retrait s'exécute désormais dans une transaction qui prend d'abord ce verrou
(`infrastructure/transaction-locks.ts`), si bien que deux retraits de la même
organisation sont sérialisés et que le second réévalue son prédicat sur l'état
commis par le premier. La règle de lint s'élargit d'un cran, et d'un seul :
`execute` dans ce fichier, `select` et `from` toujours refusés, `execute`
toujours refusé ailleurs — trois cas de `tests/lint-rules.test.ts` le tiennent.
`tests/organizations.test.ts` exerce dix courses ; sans le verrou, neuf
rougissent.

**À surveiller — s17 hérite de deux constantes.** Le rôle d'un invité est
`member`, fixe, et aucune garde de rôle n'existe : n'importe quel membre peut
inviter et retirer. C'est délibéré, écrit dans l'`AGENTS.md` du module, et c'est
s17 qui refermera.
