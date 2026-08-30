# Socle de sécurité — killer-boilerplate

> Référentiel opposable, imposé à **toute** story (ADR 012). Chaque contrôle nomme la commande ou le test qui échoue s'il est violé. Un contrôle sans vérification est une intention, pas un contrôle : il n'a pas sa place ici.
>
> Un manquement à ce socle est un finding **critical** en revue, au même rang qu'une régression fonctionnelle.

## 1. En-têtes et politique de sécurité du contenu

| Contrôle | Exigence | Vérifié par |
|---|---|---|
| `Content-Security-Policy` | `default-src 'self'`, aucun `unsafe-inline` ni `unsafe-eval` en production. Les scripts portent un nonce par requête. Les sources tierces sont **déclarées**, jamais élargies par commodité | test d'intégration sur les en-têtes de réponse |
| `Strict-Transport-Security` | `max-age` ≥ 1 an, `includeSubDomains` | idem |
| `X-Content-Type-Options` | `nosniff` | idem |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | idem |
| `X-Frame-Options` / `frame-ancestors` | `DENY` sauf story le justifiant explicitement | idem |
| `Permissions-Policy` | caméra, micro, géolocalisation refusés par défaut | idem |
| Cookies | `HttpOnly`, `Secure`, `SameSite=Lax` au minimum ; `SameSite=Strict` pour la session | test sur l'en-tête `Set-Cookie` |

**Règle de non-régression** : ajouter une source à la politique de sécurité du contenu exige une justification écrite dans la story. Un `unsafe-inline` ajouté « pour faire marcher » est un finding critical.

## 2. Sessions et authentification

- Session opaque en cookie `HttpOnly`, jamais un jeton lisible par le JavaScript client.
- Rotation de l'identifiant de session à l'élévation de privilège : connexion, validation du second facteur, fin d'impersonation.
- Révocation effective : une session révoquée est refusée **côté serveur**, pas seulement retirée d'une liste.
- Changement de mot de passe, d'email ou de second facteur ⇒ révocation des autres sessions.
- Verrouillage progressif sur échecs répétés, par compte **et** par adresse IP (s28).
- Messages d'erreur indistinguables entre compte inconnu et mot de passe invalide, y compris en temps de réponse.
- Jetons à usage unique (vérification, réinitialisation, invitation, magic link) : durée de vie courte, consommation atomique, invalidation des jetons frères à l'usage.
- Secrets de second facteur et codes de secours stockés hachés.

## 3. Autorisation

- Vérification **côté serveur** systématique. Masquer un élément d'interface n'est jamais une permission.
- Une ressource appartenant à une autre organisation renvoie **404**, jamais 403 : l'existence ne doit pas fuiter.
- Le propriétaire d'une donnée est résolu par une fonction unique, identique que le module organisations soit activé ou non.
- Chaque combinaison rôle × action sensible est couverte par un test d'API, pas d'interface.
- Aucune élévation implicite : un superadmin ne peut pas impersonner un autre superadmin, et le début comme la fin d'une impersonation sont journalisés.

## 4. Entrées et sorties

- Zod à **chaque** frontière : environnement, paramètres de route, corps de requête, webhooks, configuration.
- Requêtes paramétrées uniquement. Aucune concaténation SQL, y compris dans les scripts de maintenance.
- Téléversements : type MIME et taille contrôlés côté serveur avant l'émission d'une URL présignée ; jamais de confiance dans l'extension fournie par le client.
- Rendu échappé par défaut. Tout `dangerouslySetInnerHTML` exige une justification dans la story et un assainissement documenté.
- Webhooks entrants : signature vérifiée avant tout traitement, rejet en 400 sans effet de bord, idempotence par identifiant d'événement.
- Redirections : liste blanche de destinations. Aucune redirection pilotée par un paramètre non validé.

## 5. Secrets et configuration

- Aucun secret dans le dépôt. `.env.example` ne contient que des valeurs de développement local.
- Aucune lecture directe de `process.env` hors du module de configuration.
- Validation de l'environnement **au démarrage** : une variable manquante ou malformée arrête le processus en nommant la variable.
- Aucun secret dans un artefact de build, dans un journal, dans une réponse d'erreur ni dans un événement de télémétrie.
- Les erreurs renvoyées au client ne divulguent ni chaîne de connexion, ni trace d'exécution, ni nom de table.

## 6. Dépendances et chaîne d'approvisionnement

- Lockfile committé, installations en `--frozen-lockfile` dans la CI.
- Audit de vulnérabilités bloquant en CI au seuil « élevé ».
- Aucune dépendance ajoutée sans qu'une story la justifie ; une implémentation par port (ADR 008).
- Scripts de post-installation : refusés par défaut, autorisés au cas par cas.
- Scan de secrets sur le diff, bloquant en CI.

## 7. Journalisation, détection et abus

- Événements de sécurité journalisés avec leur acteur : connexion, échec de connexion, réinitialisation, changement de second facteur, impersonation, changement de rôle, suppression de compte.
- Données sensibles filtrées avant tout envoi à un service tiers ; le filtrage est **testé**, pas seulement configuré.
- Limitation de débit sur tout point d'entrée public, partagée entre instances (s28).
- Protection anti-automatisation sur les formulaires publics : captcha activable, pièges à robots, seuils configurables.
- Aucune information exploitable dans une réponse d'erreur publique : pas d'énumération de comptes, pas de différence de temps de réponse observable.

## Comment une story démontre sa conformité

1. Elle nomme, dans son plan, les sections de ce socle qui la concernent.
2. Chaque contrôle applicable est couvert par un test ou marqué **recette manuelle** avec une trace consignée dans la revue.
3. La revue vérifie les contrôles, pas les intentions : elle mute le code et constate que le test devient rouge.

## Ce qui reste hors périmètre

Le journal d'audit alimenté par chaque module, les clés d'API pour les clients du SaaS et les webhooks sortants restent au cimetière du PRD. La journalisation de sécurité décrite en §7 est applicative — elle ne constitue pas une table d'audit métier.
