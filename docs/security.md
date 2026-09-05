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
- **Un paiement n'ouvre jamais de session** (s24). Une page de retour de
  paiement n'accorde rien : ni depuis un paramètre d'URL, ni depuis un
  identifiant de session du fournisseur. Le seul chemin vers un compte créé par
  un paiement est un lien envoyé à l'adresse — et si cette adresse possède déjà
  un compte, ce lien **connecte** (magic link), il ne redéfinit pas le mot de
  passe : sinon n'importe qui déclencherait, en payant, une réinitialisation sur
  le compte d'un tiers.
- Codes de secours stockés **hachés** ; secret de second facteur **chiffré**
  au repos et exposé une seule fois, à l'enrôlement de son propriétaire. La
  ligne disait « hachés » pour les deux jusqu'à s13 : un secret TOTP est
  réversible par construction — le vérifier, c'est regénérer le code, donc
  relire le secret. Le découpage, ce qu'il change et ce qu'il ne relâche pas :
  **ADR 028**.

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
- Limitation de débit sur tout point d'entrée public, partagée entre instances —
  **livrée par s28** (ADR 050, dont l'ADR 051 supersède la seule clause du seau
  de défi 2FA). Le relevé daté qui tenait cette ligne a été remplacé par une
  **garde exécutable**, ce qu'il annonçait lui-même :

  | Ce qui est tenu | Où | Ce qui échoue si on le viole |
  |---|---|---|
  | Toute route **publique** du catalogue est limitée, sans qu'aucune ne soit nommée | `routeIsRateLimited` (`@repo/core`), dérivé du registre | `pnpm test` (`tests/rate-limiting.test.ts`) |
  | Les huit points d'entrée que la story énumère sont couverts, et le **compte** est assertionné | idem, plus les déclarations `rateLimit` des modules | `pnpm test` |
  | La **double limitation** de la connexion — par appelant **et** par compte visé | `createRouteRateLimitGuard` | `pnpm test` — dix mille adresses distinctes contre le même compte |
  | Le compteur est **partagé entre instances** | `rate_limit_window`, une instruction atomique | `pnpm test` — deux connexions distinctes contre un vrai PostgreSQL |
  | Les seuils viennent de la configuration, et un seuil nul est **refusé au démarrage** | `config/security.ts`, `parseRateLimitPolicies` | `pnpm dev`, `pnpm test` |
  | **Aucune variable d'environnement** ne désactive la limitation | balayage **dérivé du disque** — tout `packages/modules/rate-limit/`, plus quatre chemins nommés — doublé d'une recherche d'interrupteur (`DISABLE_*`, `SKIP_*`, `BYPASS_*`) dans toutes les sources de production | `pnpm test` — le balayage assertionne son propre plancher, si bien qu'un chemin qui disparaîtrait sans être remplacé rougit |
  | Le dépassement répond **429 avec `Retry-After`**, et la valeur suit la fenêtre réelle | `dispatchModuleRequest` | `pnpm test` |
  | Le magasin indisponible **refuse** | `createRouteRateLimitGuard` (ADR 050) | `pnpm test` |
  | Un balayage n'efface qu'un seau dont **sa propre** fenêtre est close | `expires_at` porté par la ligne | `pnpm test` — un seau horaire survit au balayage d'une fenêtre de dix minutes |
  | La récupération ne dépend d'**aucun module optionnel** | le garde balaie, et le module déclare une tâche planifiée | `pnpm test` |
  | L'énumération des codes de double authentification est bornée **par défi**, pas par en-tête | `subjectCookies` (noms **exacts**) sur les deux routes de vérification | `pnpm test`, `pnpm test:e2e` — le leurre de cookie est posé **en tête** dans les deux |
  | Le seau compte **la valeur que le serveur lit** : guillemets encadrants retirés, `%XX` décodé, jamais deux normalisations | `subjectOfCookies` (`packages/modules/rate-limit`), qui refait les gestes de `better-call@1.4.0/dist/cookies.mjs:19-40` | `pnpm test`, `pnpm test:e2e` — le **même défi ré-encodé** à chaque essai doit refuser au seuil |
  | Deux cookies de défi déclarés dans la même requête ⇒ **refus**, jamais un choix | `createRouteRateLimitGuard` | `pnpm test` |
  | Le seuil de ce dépôt mord **avant** le plafond par défi de la bibliothèque, qui est le second filet | `twoFactor.maxPerSubject` (4) contre `beginAttempt(5)` de `better-auth@1.7.2` | `pnpm test` — le plafond est **dérivé de la bibliothèque installée**, donc une version qui le déplace rougit |

  **Mesure du 3 septembre 2026**, dérivée du registre et non d'un `grep` : le
  catalogue complet — modules non activés compris — déclare **26 routes
  publiques** (`auth` 19, `billing` 2, `consent` 1, `marketing` 2,
  `demo-enabled` 1, `demo-disabled` 1) et **31 points d'entrée limités**, les
  cinq autres étant des routes authentifiées que la story nomme : invitation,
  relance d'invitation, et les trois du téléversement. Ce sont des planchers
  assertionnés, pas un inventaire de ce qui existe.

  **Ce que « tout point d'entrée public » veut dire ici** : toute route servie
  par le **répartiteur de modules**. Cinq fichiers de route Next vivent en
  dehors (`find apps/web/app/api -name route.ts`, moins le répartiteur) et ne
  sont **pas** limités :

  | Route hors répartiteur | Pourquoi elle n'est pas limitée |
  |---|---|
  | `/api/health` | sonde de disponibilité : un limiteur qui la refuse signale une panne qu'il a lui-même provoquée. Aucune entrée utilisateur, aucune écriture |
  | `/api/csp-report` | dépôt de rapports envoyés par le navigateur, pas par un formulaire |
  | `/api/i18n-probe` | **404 en production** |
  | `/api/consent-probe/[script]` | **404 en production** |
  | `/api/billing-local-checkout` | **404 en production** (mode local uniquement) |

  Le **compte** est assertionné par `tests/rate-limiting.test.ts` : une sixième
  route hors répartiteur force la décision au lieu d'hériter du silence.

  **Les deux compteurs d'avant s28** — `public_form_throttle` (s11) et
  `billing_checkout_throttle` (s24) — ne sont **plus écrits**. Leurs tables
  restent en place, vides et inertes : `docs/reliability.md` impose de cesser
  d'écrire avant de supprimer, et la version encore en ligne les écrit pendant
  une bascule. Leur suppression est une story ultérieure ; un test refuse à la
  fois qu'on les réécrive et qu'on les supprime ici.
- Protection anti-automatisation sur les formulaires publics : pièges à robots
  (`marketing`, s11) et seuils configurables (`config/security.ts`, s28). Le
  **captcha est encadré mais pas livré** : `config/security.ts` le déclare coupé,
  et le démarrage refuse de l'activer tant que son origine n'est pas déclarée
  dans la politique de sécurité du contenu — le navigateur bloquerait sinon le
  widget et fermerait le formulaire sans un mot. **Aucun fournisseur n'est
  branché** : c'est un manque nommé, pas une fonctionnalité.
- **Aucun écran applicatif dans un index public.** `robots.txt` et `sitemap.xml`
  n'annoncent que ce qu'un module **déclare** publier (`publicUrls`, ADR 054).
  Une page ouverte à tous n'y entre pas pour autant : `public` est un niveau de
  **protection** — qui peut entrer —, pas une décision d'**indexation** — ce qui
  mérite un index. Publier `/sign-in`, `/pricing` ou une route d'API dans un
  moteur ne contourne aucune autorisation ; ça dresse la carte de la surface de
  l'application pour qui la cherche, et la tient à jour tout seul à chaque story
  suivante. Le contrôle est **dérivé** : aucun chemin n'y est nommé, et la règle
  est celle-ci depuis s10, promue en contrôle par s53 — six citations la
  désignaient sans qu'elle soit écrite.

  | Ce qui est tenu | Où | Ce qui échoue si on le viole |
  |---|---|---|
  | Ce que le `robots.txt` autorise est confronté à **chaque écran du disque**, dans chaque langue servie, et lu **par préfixe** comme un robot le lit | balayage de `apps/web/app` | `pnpm test` (`tests/marketing.test.ts`) |
  | Une entrée de navigation **publique** n'entre ni dans le plan de site, ni dans la liste d'autorisation | `indexableUrls` (`@repo/core`), qui ne lit que la clé `publicUrls` | `pnpm test` (`tests/syndication.test.ts`, `packages/core/src/syndication.test.ts`) — rebrancher la navigation les fait rougir : mutation du 5 septembre 2026, **7 cas** |
  | Trois chemins privés servis — `/account`, `/sign-in`, `/reset-password?token=…` — restent hors du fichier **réellement servi** | `PRIVATE_PATHS` | `pnpm test:e2e` (`e2e/marketing.spec.ts`) |

  Aucun plan de site n'est annoncé quand aucun module ne publie : une adresse
  qui ne référence rien est une invitation à chercher.
- Aucune information exploitable dans une réponse d'erreur publique : pas d'énumération de comptes, pas de différence de temps de réponse observable.

## Comment une story démontre sa conformité

1. Elle nomme, dans son plan, les sections de ce socle qui la concernent.
2. Chaque contrôle applicable est couvert par un test ou marqué **recette manuelle** avec une trace consignée dans la revue.
3. La revue vérifie les contrôles, pas les intentions : elle mute le code et constate que le test devient rouge.

## Ce qui reste hors périmètre

Le journal d'audit alimenté par chaque module, les clés d'API pour les clients du SaaS et les webhooks sortants restent au cimetière du PRD. La journalisation de sécurité décrite en §7 est applicative — elle ne constitue pas une table d'audit métier.
