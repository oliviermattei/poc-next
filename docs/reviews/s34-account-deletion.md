# Revue — s34-account-deletion

Story de droit à l'effacement : les bases de sécurité et de confidentialité y pèsent plus qu'ailleurs. **Quatre rondes de revue, cinq de correction.** Sévérité : `critical` → `major` → `major` → `minor`.

## Ce que la story était réellement

`purgeModules` existait dans le socle, parcourait les modules en ordre inverse (ADR 029) et **n'était appelée par rien**. C'est le motif que `s33` venait de fermer sur la clé `jobs` du contrat. s34 la branche ; elle ne l'invente pas.

## Trois trous de confidentialité, aucun cherché

Tous trouvés par des gardes **dérivés du contrat**, qui ne nomment aucun module.

1. **`auth_verification` n'a aucune clé étrangère vers `auth_user`** — ses lignes sont indexées par adresse. Un jeton de vérification survivait donc au compte supprimé **en portant son adresse**. Aucune cascade ne pouvait l'attraper.
2. **`admin_platform_role.granted_by` gardait l'identifiant du promoteur** après son effacement. Pas de clé étrangère, purge vide. Fermé par la première catégorie `anonymize` réelle du dépôt — `erase` aurait retiré le rôle d'un tiers et pu rendre la plateforme inadministrable.
3. **`deleteNaming` effaçait par sous-chaîne.** Mesuré : supprimer `a@b.co` détruisait le jeton vivant de `a@b.com`. Le premier correctif — échapper les jokers — était le mauvais : la réponse est de **ne pas employer de joker**, les valeurs à atteindre étant connues et fermées.

## Le critique, et sa fermeture

**Une organisation pouvait rester sans aucun propriétaire**, et le diff écrivait que c'était impossible. Le refus du dernier propriétaire n'était évalué **qu'à la requête** ; le corps de la tâche qui efface ne le revérifiait jamais. Dans la configuration livrée `jobs` est activé et diffère l'exécution hors requête — la fenêtre était donc réelle en production, et fermée seulement quand le module est coupé, c'est-à-dire la configuration que `test:minimal-profile` joue. C'est pourquoi rien ne l'attrapait.

Atteint par le relecteur **avec trois appels de route** :

```
1. POST /delete-account       → 202, tâche en file (aucune organisation possédée)
2. POST /organizations/create → organisation créée, 1 propriétaire
3. la tâche s'exécute         → compte effacé
   organisation restante = 1 · propriétaires = 0
```

Et le diff supprimait l'assignation de `s17` — la commande de réconciliation confiée à s34 — sur cette prémisse fausse.

### La décision : refuser, pas promouvoir

Le critère 6 dit que la personne « doit d'abord transférer ou supprimer ». Promouvoir automatiquement retire la décision **aux deux parties** : celui qui part, et celui qui hériterait d'une organisation, de sa facturation et de ses données sans avoir rien demandé.

Le coût du refus est payé, pas ignoré : la requête avait été acceptée (202) et ne sera pas honorée, donc un **cinquième modèle d'email** dit ce qui s'est passé et quoi faire. Un refus silencieux sur un chemin de droit à l'effacement serait pire que la fenêtre.

### Deux correctifs proposés, deux refusés sur mesure

**J'avais demandé le mauvais correctif deux fois**, et la mesure m'a corrigé les deux fois.

D'abord l'échappement des jokers, là où il fallait supprimer le joker.

Puis, sur le critique : j'avais proposé de tenir `pg_advisory_xact_lock` **à travers `purgeScope`**. Refusé, et le relecteur a confirmé le refus : le verrou est tenu par une transaction, donc par une connexion du pool — le tenir à travers la purge signifie une connexion **inactive-en-transaction** pendant des appels sortants vers S3 et Stripe, sans délai sur l'attente, avec épuisement du pool sous charge, et une purge qui échoue *en tenant* les verrous qui gardent chaque `removeMember` de ces organisations.

**Ce qui a été construit à la place : revendiquer au lieu de lire.** `releaseMemberships` retire les appartenances **ou refuse**, en une transaction courte, sous verrou. Le second concurrent recompte sur l'état validé par le premier, se découvre dernier propriétaire, et refuse **avant que `purgeScope` ne soit appelée**. *« Deux lectures ne pourraient jamais faire ça — des lectures concurrentes se voient l'une l'autre ; une revendication sérialise. »*

## Table de mutation — les fermetures qui comptent

| Mutation | Avant | Après |
|---|---|---|
| la revendication dégradée en lecture | — | **1**, au message exact de la ronde 3 |
| verrous retirés de la revendication | — | **1** |
| prédicat de dernier propriétaire neutralisé | — | **4** |
| prédicat ancré remis en `%…%` | — | **3** |
| échappement retiré de `<userId> %` | **0** | **1** (après le cas qui l'exerce) |
| `purgeModules` rend la liste complète après échec | — | **1** |
| ordre inverse de purge retiré (ADR 029) | — | **4** |
| `users.deleteById` neutralisé | — | **11** |
| catégorie `anonymize` d'`admin` passée en `erase` | — | **1** |
| effacement de l'adresse d'invitation désactivé | **0** | **2** |
| délégué de câblage échangé (`lib/auth.ts`) | **0** | **1** |
| délégué de câblage échangé (`lib/organizations.ts`) | **0** | **1** |

**Quatre mutations sont revenues vertes d'abord**, et les deux chiffres sont rapportés à chaque fois. Le cas le plus instructif : sans le re-contrôle avant purge, le garde du module refusait quand même — mais **l'ordre de purge étant le graphe inverse**, `storage` était effacé *avant* qu'`organizations` ne refuse. Un refus ne doit rien effacer en chemin.

## L'ordre de purge, dérivé et non supposé

```
demo-enabled → storage → rate-limit → organizations → notifications → … → admin → auth
```

Le relecteur a **balayé les quinze modules purgés après la revendication** pour vérifier qu'aucun ne résout les données d'un utilisateur par son appartenance — puisque la revendication les supprime en premier. Tous passent par l'identifiant du propriétaire.

## Ce qui a été trouvé par un correctif, pas par une revue

Ajouter `admin` à la suite a rendu **reproductible la course de migration** que `s52` avait établie *par lecture* et reportée faute de pouvoir l'observer : deux travailleurs émettent le même `create table`, le perdant meurt. Le premier correctif la **déplaçait** sur un autre fichier ; elle vit maintenant dans `runMigrations` (ADR 060, quatre options rejetées dont une mesurée).

Déclaré honnêtement : muter l'*usage* du prédicat de discrimination reste vert — une migration réellement fautive échoue de toute façon, Drizzle enveloppant la boucle entière en transaction. La discrimination borne le coût et la latence, pas le résultat.

## Une réassurance retirée plutôt que nuancée

L'email de refus disait « Aucune de vos données n'a été effacée ». Un résidu étroit subsiste — la revendication d'une tentative précédente peut avoir effacé le stockage avant qu'une seconde refuse définitivement. La phrase a été **supprimée des deux langues** plutôt qu'assouplie : ce qui reste est vrai dans tous les cas.

## Non vérifié

**Aucun écran** : l'interface est dans `s34b-suppression-ecrans`, découpée sur `dev` — mon plan n'en portait aucune tâche alors que le critère 1 décrit un geste utilisateur, et c'est une omission de plan relevée en revue.

**Aucun tiers réel.** S3, Stripe et Inngest n'ont jamais été appelés : la prémisse « les fichiers sont irréversiblement perdus », qui motive tout le correctif du critique, est **inférée de l'ordre de purge, pas observée sur un seau**. La course a été mesurée sur un PostgreSQL local, cinq itérations, deux appelants **dans le même processus** — jamais deux instances contre une base partagée, qui est la forme que le verrou consultatif existe pour couvrir.

**`apps/web/lib/auth.ts` n'a jamais été démarré** : le câblage est tenu par une lecture de source. Une suppression réelle par l'application est le seul geste qui prouve que le point de composition délègue à la bonne fonction.

Max severity: minor
Ship allowed: yes
