# Research — Story s06-transactional-emails

## The five structuring facts

1. **C'est un module du socle, non désactivable** — décidé en s03 et inscrit dans le tableau d'`AGENTS.md`. L'authentification (s07) envoie vérification, magic link et réinitialisation ; les invitations (s16), le guest checkout (s24), la suppression de compte (s34) et l'export (s35) en dépendent aussi. Un mailer optionnel rendrait cinq parcours indéfinis. Il n'a donc **pas** de critère « module non activé ».
2. **Une seule implémentation livrée : Resend** (ADR 008). Les doublures — enregistrement en CI, capture locale en développement — sont des **outils de test**, pas des providers. Cette distinction a déjà été relevée en revue de s01 : elles ne rendent jamais légitime l'ajout d'un adapter SMTP ou SendGrid, qui restent au cimetière.
3. **Le contrat de module porte déjà `emails`**, avec leurs locales, et `assertDeclarationsAreComplete` vérifie qu'un template déclare une version par locale du module. s06 fournit le **moteur** ; les templates métier viendront avec leurs modules. Le module `demo-enabled` peut porter le template de démonstration.
4. **Deux régimes de test, jamais mélangés** (préambule de `docs/stories.md`) : en CI, doublure d'enregistrement, bloquante ; hors CI, sur commande explicite, clé de test Resend. La doublure doit être **injectée**, jamais conditionnée par `NODE_ENV` — piège déjà nommé en s01.
5. **Le socle de fiabilité s'applique en entier ici.** §2 : un provider injoignable **dégrade** — l'inscription échoue proprement en le disant, elle ne fait pas tomber la requête. §3 : tout appel réseau sortant porte un **délai d'attente explicite**, et les reprises suivent un recul exponentiel avec dispersion, uniquement sur erreurs transitoires. Rejouer une erreur de validation est un défaut.

## Target story

`s06-transactional-emails` — complexité 3, dépend de s03. Sept critères : interface `Mailer` seule surface appelée par le code métier ; doublure d'enregistrement en CI assertant destinataire, template et données ; test contre la clé de test Resend hors CI ; capture locale sans clé d'API ; template React Email de démonstration rendu et testé ; échec provider journalisé et remonté sans faire tomber la requête ; documentation de délivrabilité SPF/DKIM/DMARC vérifiée par un test de présence.

## Current state of the code

`packages/core` (contrat, registre, protection), `packages/db` (client, barils, migrations par module), `packages/cli`, `packages/config` (environnement validé au démarrage, entrée serveur séparée), `apps/web`, `tooling/eslint` (couches + pureté du `domain`), deux modules de démonstration. 263 tests. **Aucun port, aucun adapter n'existe** : `packages/ports` et `packages/adapters` sont annoncés par l'architecture mais vides de contenu — s06 les crée.

## Anchor points

| À créer | Rôle |
|---|---|
| `packages/ports/src/mailer.ts` | L'interface `Mailer`, dans la couche que le domaine peut connaître |
| `packages/adapters/resend/` | L'unique implémentation livrée |
| Doublure d'enregistrement | Outil de test, exporté pour les suites |
| Capture locale | Développement sans clé : écriture sur disque ou consultation locale |
| Templates React Email | Le rendu, et un template de démonstration |
| Documentation de délivrabilité | SPF, DKIM, DMARC, avec test de présence des trois |

**Point d'attention structurel** : c'est la première fois que `packages/ports` et `packages/adapters` prennent corps. La forme retenue ici servira de gabarit à storage (s18), paiement (s19), jobs (s33), analytique et monitoring (s39). Une erreur de forme se paiera cinq fois.

## Verified APIs / functions

Versions relevées sur le registre npm au moment de la recherche (le lockfile fera foi, ADR 010) : `resend` **6.25.0**, `@react-email/components` **1.0.12**, `react-email` **6.9.3**.

À vérifier **dans les paquets installés**, jamais depuis la documentation en ligne — c'est le piège qui a coûté un tour à s01 et deux à s05 : la signature exacte d'envoi du SDK Resend, la forme de son objet d'erreur (Resend rend classiquement `{ data, error }` plutôt que de lever), et l'API de rendu de React Email (`render` synchrone ou asynchrone selon la majeure).

## Traps & constraints

- **La doublure doit être injectée.** Un mailer choisi par `NODE_ENV` est intestable et se trompera un jour d'environnement.
- **Aucun secret dans un journal.** Le socle §5 l'exige, et le filtrage doit être **testé**, pas seulement configuré — leçon de s01 sur la sonde de santé, où le test de non-divulgation était décoratif jusqu'à ce qu'une mutation le prouve.
- **Le délai d'attente est obligatoire.** Un appel sans délai fera pendre une requête d'inscription.
- **Ne pas envoyer d'email réel depuis les tests.** Le régime CI est l'enregistrement.
- **`domain` ne connaît pas le mailer.** La règle de couches l'interdit : le port vit dans `application`, l'implémentation dans `infrastructure`. Le lint le vérifie depuis s02.
- **Pas de second adapter**, sous aucun prétexte.

## Open questions

1. **Où vit exactement le port ?** `packages/ports` partagé, ou dans la couche `application` de chaque module ? L'architecture annonce `packages/ports` ; c'est le gabarit pour cinq autres adapters, donc à trancher au plan.
2. **La capture locale écrit-elle sur disque ou expose-t-elle une page ?** Le critère dit « consultable localement ». Le plus simple qui satisfait : un fichier par email dans un dossier ignoré par git.
3. **Le rendu React Email est-il fait à l'envoi ou en amont ?** Impacte le test de rendu et la traduction des templates (s09).

## Real complexity

**Verdict : 3**, conforme. Le code est modeste ; le risque est dans la **forme du port**, qui sera copiée cinq fois. Second risque : les deux régimes de test, dont s01 a montré qu'ils se mélangent facilement — un test qui prétend vérifier un envoi réel alors qu'il interroge une doublure ne prouve rien.
