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
- Aucun port ne dépend d'une clé de fournisseur pour fonctionner **en développement local** : capture locale des emails, stockage sur disque, jobs exécutés en mémoire (`JOBS_LOCAL_RUNNER=1`, s33 — sa file ne survit pas au processus et n'est pas partagée entre instances), analytique inerte. Ce mode local est **explicite** — un drapeau que le développeur pose, jamais une déduction depuis `NODE_ENV` ni depuis l'absence de clé. Sans clé et sans drapeau, le processus refuse de démarrer en nommant la variable : une substitution silencieuse rendrait un envoi capturé indiscernable d'un envoi réel, y compris en production.
- Une panne de service tiers ne bloque jamais une requête au-delà de son délai d'attente, et n'écrit jamais un état partiel qu'aucune reprise ne peut rattraper.
- Toute opération multi-étapes est **reprenable** : soit elle est atomique, soit elle laisse un état explicite permettant de la rejouer.

## 3. Délais et reprises

- Tout appel réseau sortant porte un délai d'attente explicite. Aucun appel sans délai.
- Les reprises suivent un recul exponentiel avec dispersion, et un nombre maximal d'essais ; au-delà, l'échec est définitif, journalisé et visible.
- Les reprises ne s'appliquent qu'aux erreurs transitoires. Rejouer une erreur de validation est un défaut, pas une précaution.
- Le pool de connexions à la base est dimensionné par configuration, jamais figé dans le code.
- **Un contrôle bloquant qui interroge un tiers reprend, lui aussi.** `pnpm run audit` interroge le
  registre : sans reprise, une panne réseau le faisait rougir du premier coup (s48), et une porte
  qui rougit pour une panne finit par s'ignorer. Elle fait **trois tentatives au plus** — donc deux
  rejeux —, avec recul exponentiel, dispersion et plafond, **uniquement** sur la branche « l'audit
  n'a pas eu lieu » : jamais un document d'avis lu correctement, qu'il bloque ou non, le rejouer
  serait un vert obtenu par patience. La distinction entre les deux est celle de
  `scripts/audit-exceptions.ts`, et c'est elle qui rend la reprise sûre. L'appel lui-même porte un
  **délai d'attente explicite** (`AUDIT_TIMEOUT_MS`, soixante secondes contre ~1,4 s pour un audit
  nominal mesuré sur ce dépôt) : sans lui, un registre qui accepte la connexion sans répondre tenait
  le job ~4 minutes, et trois tentatives auraient triplé cette attente.

## 4. Migrations et compatibilité

- Toute migration est **rétrocompatible** avec la version encore en ligne pendant le basculement : ajouter avant de lire, cesser d'écrire avant de supprimer.
- Une migration destructive est interdite hors d'un `eject` explicite (cimetière du PRD) ; désactiver un module ne supprime jamais ses tables.
- Les migrations sont des fichiers SQL versionnés, jamais un `push`.
- Un échec de migration interrompt le déploiement avant le basculement du trafic.

## 5. Observabilité opérationnelle

- Une sonde de santé distingue « démarré » de « prêt » : elle vérifie réellement la dépendance critique, elle ne renvoie pas 200 par principe.
- Les erreurs non gérées sont remontées avec une trace exploitable ; les données sensibles sont filtrées avant envoi, et le filtrage est **testé**.
- Les échecs définitifs de jobs, de webhooks et de synchronisations externes sont visibles sans lire les journaux bruts.
- Une garde de démarrage ne vaut que par le point d'entrée qui l'exécute, et `next.config.ts` n'en est pas un en production : `output: 'standalone'` sérialise la configuration de Next dans `server.js` et cesse de charger le fichier au démarrage du serveur. Le point qui reste est `instrumentation.ts`, appelé une fois par instance de serveur ; c'est là que la garde vit depuis s27 (ADR 049), et sur toute cible Docker l'image **refuse de démarrer**, en nommant la variable fautive et en sortant en code 1.
- **Sortir en erreur, en revanche, dépend de la plateforme.** En serverless (Vercel), `instrumentation.ts` s'exécute bien par instance de fonction, mais aucun orchestrateur n'y lit de code de sortie et aucun déploiement n'y est retenu pour autant : une variable malformée s'y déploie, et c'est la sonde `/api/health` qui reste le signal. Non mesuré sur Vercel — `docs/deployment.md` le dit aussi.
- Toute divergence possible avec un système externe possède une **commande de réconciliation** — c'est le cas de la quantité de sièges facturés face au nombre réel de membres.
- Cette commande réconcilie **dans les deux sens, selon le champ** (ADR 046). Le statut, la période et l'offre viennent du fournisseur, qui fait foi (ADR 034) ; la **quantité de sièges** va vers lui, parce que le nombre de membres est ce qui fait foi et que la quantité en est dérivée. Deux gardes en découlent : la commande n'efface jamais, et elle ne **baisse** aucune quantité sur une lecture de membres en échec ou vide — un silence de notre base interrompt la réconciliation au lieu de réduire une facture.

## 6. Ce qu'une suppression de compte laisse derrière elle quand elle échoue

La purge d'un compte (s34) traverse **tous les modules activés**, chacun avec sa
propre transaction : elle n'est pas atomique d'un module à l'autre, et elle n'a
pas à l'être — elle est **rejouable**, c'est le rejeu qui répare. Ce paragraphe
existe parce qu'un état intermédiaire peut malgré tout demander un geste humain,
et qu'aucun journal ne le dit.

**Ce que dit le journal** : `job.failed`, un code — le plus souvent
`provider_unavailable` — et le module fautif, par exemple « la purge du module
« storage » a échoué ». La tâche sera rejouée.

**Ce que le journal ne dit pas** : la suppression **revendique d'abord** le
départ des organisations du compte, avant toute purge, pour qu'un départ
simultané de deux copropriétaires ne laisse aucune organisation sans
propriétaire. Cette revendication est **committée** avant les purges. Un échec
survenu ensuite laisse donc la personne **retirée de ses organisations** alors
que son compte existe encore, jusqu'au rejeu.

**Le rejeu répare la suppression, pas l'appartenance.** Si la personne renonce —
ou si l'échec persiste et que la tâche est abandonnée —, aucune commande ne
réajoute un membre : le geste est une **ré-invitation par un propriétaire
restant**, par les chemins normaux du produit. C'est une opération humaine, elle
n'a pas de commande, et c'est le seul cas de ce socle où la réparation n'est pas
automatique.

À surveiller, donc : un `job.failed` répété sur `auth.purge-account` mérite de
vérifier les appartenances du compte concerné, pas seulement de relancer.

## Comment une story démontre sa conformité

1. Son plan nomme les sections applicables de ce socle.
2. Chaque contrôle applicable est couvert par un test, ou marqué recette manuelle avec trace en revue.
3. La revue exécute deux fois ce qui doit être idempotent, et coupe ce qui doit dégrader.
