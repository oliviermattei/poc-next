# Socle de fiabilité — killer-boilerplate

> Référentiel opposable, imposé à toute story (ADR 014). Comme `docs/security.md`, chaque contrôle nomme la vérification qui échoue s'il est violé. Un manquement est un finding **critical** en revue.

## 1. Idempotence

| Contrôle | Exigence | Vérifié par |
|---|---|---|
| Webhooks entrants | Journalisés par identifiant d'événement ; un rejeu ne produit **aucun** effet supplémentaire | test rejouant deux fois le même événement enregistré |
| Jobs de fond | La même exécution rejouée ne duplique rien | test exécutant deux fois le job |
| Migrations | Un second passage ne modifie rien | test lançant `db:migrate` deux fois |
| Seed | Rejouable sans doublon (identifiants déterministes ou `onConflictDoNothing`) | test lançant `db:seed` deux fois |
| Opérations d'écriture déclenchées par l'extérieur | Clé d'idempotence ou contrainte d'unicité, jamais une simple vérification préalable — elle laisse une fenêtre de concurrence | test concurrent |

**Règle** : « idempotent » ne s'écrit pas dans un commentaire, il se prouve en exécutant deux fois et en constatant un seul effet.

## 2. Dégradation

- L'indisponibilité d'un port **dégrade** l'application, elle ne la casse pas : sans service d'email, l'inscription échoue proprement en le disant ; sans analytique, l'application fonctionne ; sans jobs, purge et export s'exécutent en synchrone.
- Aucun port ne dépend d'une clé de fournisseur pour fonctionner **en développement local** : capture locale des emails, stockage sur disque, jobs synchrones, analytique inerte. Ce mode local est **explicite** — un drapeau que le développeur pose, jamais une déduction depuis `NODE_ENV` ni depuis l'absence de clé. Sans clé et sans drapeau, le processus refuse de démarrer en nommant la variable : une substitution silencieuse rendrait un envoi capturé indiscernable d'un envoi réel, y compris en production.
- Une panne de service tiers ne bloque jamais une requête au-delà de son délai d'attente, et n'écrit jamais un état partiel qu'aucune reprise ne peut rattraper.
- Toute opération multi-étapes est **reprenable** : soit elle est atomique, soit elle laisse un état explicite permettant de la rejouer.

## 3. Délais et reprises

- Tout appel réseau sortant porte un délai d'attente explicite. Aucun appel sans délai.
- Les reprises suivent un recul exponentiel avec dispersion, et un nombre maximal d'essais ; au-delà, l'échec est définitif, journalisé et visible.
- Les reprises ne s'appliquent qu'aux erreurs transitoires. Rejouer une erreur de validation est un défaut, pas une précaution.
- Le pool de connexions à la base est dimensionné par configuration, jamais figé dans le code.

## 4. Migrations et compatibilité

- Toute migration est **rétrocompatible** avec la version encore en ligne pendant le basculement : ajouter avant de lire, cesser d'écrire avant de supprimer.
- Une migration destructive est interdite hors d'un `eject` explicite (cimetière du PRD) ; désactiver un module ne supprime jamais ses tables.
- Les migrations sont des fichiers SQL versionnés, jamais un `push`.
- Un échec de migration interrompt le déploiement avant le basculement du trafic.

## 5. Observabilité opérationnelle

- Une sonde de santé distingue « démarré » de « prêt » : elle vérifie réellement la dépendance critique, elle ne renvoie pas 200 par principe.
- Les erreurs non gérées sont remontées avec une trace exploitable ; les données sensibles sont filtrées avant envoi, et le filtrage est **testé**.
- Les échecs définitifs de jobs, de webhooks et de synchronisations externes sont visibles sans lire les journaux bruts.
- Une garde de démarrage ne protège que les plateformes qui exécutent réellement un démarrage : en serverless et en `output: 'standalone'`, la validation d'environnement de Next n'est pas rejouée à la requête, et une variable malformée dégrade en 503 silencieux — c'est la sonde de santé, pas le démarrage, qui doit alors le signaler.
- Toute divergence possible avec un système externe possède une **commande de réconciliation** — c'est le cas de la quantité de sièges facturés face au nombre réel de membres.

## Comment une story démontre sa conformité

1. Son plan nomme les sections applicables de ce socle.
2. Chaque contrôle applicable est couvert par un test, ou marqué recette manuelle avec trace en revue.
3. La revue exécute deux fois ce qui doit être idempotent, et coupe ce qui doit dégrader.
