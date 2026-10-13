# ADR 026 — Le jeton d'invitation appartient au module `organizations`, et l'acceptation ne fait pas tourner l'identifiant de session

- Status: accepted
- Date: 2026-08-31

**Le module `organizations` émet son propre jeton**, dans `organization_invitation` : 32 octets du générateur cryptographique, stockés en empreinte SHA-256 ; le secret en clair n'existe que dans le lien envoyé. Le ranger dans `auth_verification` ferait porter une donnée d'organisation à une table du module `auth`, qui survivrait à la coupure du module — le raisonnement de l'ADR 025, appliqué au jeton.

**La consommation est un seul ordre conditionnel** (`update … where token_hash = ? and email = ? and accepted_at is null and revoked_at is null and expires_at > now() returning …`), suivi de l'appartenance en `onConflictDoNothing`. La ligne survit à sa consommation, ce qui permet de dire « expirée », « révoquée » ou « déjà acceptée ». L'adresse du destinataire est dans le prédicat : un email transféré, une boîte partagée ou un moteur d'aperçu de lien ne donnent pas l'accès. L'acceptation est une soumission, jamais un `GET` — un antivirus ou un proxy qui suit le lien consommerait le jeton avant l'invité.

**Un envoi est une ligne.** Le renvoi éteint l'invitation précédente (révoquée, empreinte remplacée par celle d'un jeton que personne n'a reçu) et en écrit une neuve, si bien que le quota d'émission — 20 par organisation et par heure, compté dans la table — compte aussi les renvois. Ce quota n'est pas la limitation de débit des points d'entrée publics (ADR 050) : la route d'invitation est authentifiée.

**L'acceptation ne fait pas tourner l'identifiant de session.** L'appartenance est relue à chaque requête dans le prédicat de la lecture ; il n'y a rien à faire tourner, et la même session perd l'accès à l'instant où la ligne d'appartenance disparaît.

## Considered options

- **Un jeton signé (JWT, HMAC) plutôt que stocké** — rejeté : ni révocable, ni à usage unique ; rejouable jusqu'à son échéance.
- **Faire tourner l'identifiant de session à l'acceptation** — rejeté. La rotation protège contre la fixation de session : l'attaquant implante son identifiant chez la victime et attend qu'elle gagne un droit. Ici la fixation est fermée structurellement, parce que l'adresse du destinataire est dans le prédicat de consommation : une session implantée, dont le compte porte l'adresse de l'attaquant, ne consomme aucune invitation. À rouvrir si `ModuleSession` se met à porter une autorité organisationnelle, si une lecture met l'appartenance en cache, ou si le module `auth` expose une rotation applicable à l'appelant — l'appliquer ne coûterait alors plus rien. Aujourd'hui `auth` ne remplace la session que pour l'impersonation.

## Consequences

Un invité dont le compte porte une autre adresse doit être réinvité (`error.invitation_other_recipient`) : c'est le prix de la non-transférabilité. Un ancien lien, ou un écran resté ouvert sur l'ancien identifiant, répond « lien inconnu » après un renvoi.

Le quota compte avant d'écrire : des requêtes concurrentes peuvent le dépasser d'autant qu'elles sont parallèles, jamais dans la durée.

Le retrait d'un membre et le changement de rôle se sérialisent par `pg_advisory_xact_lock` sur l'organisation (`infrastructure/transaction-locks.ts`), sans quoi deux retraits parallèles laissaient une organisation sans propriétaire. Ce verrou ne lit aucune table : la règle de lint qui réserve les lectures à `scoped-reads.ts` autorise `execute` dans ce seul fichier. Les rôles et leurs gardes relèvent de l'ADR 030.
