# Revue du processus killer-saas

> Ce que la traversée de 46 stories apprend **sur le pipeline lui-même**, et ce
> qu'on en change. `docs/STATE.md` dit où on en est ; ce fichier dit comment on
> travaille et pourquoi, et il se met à jour quand une mesure contredit une
> habitude.

## Ce qui a réellement trouvé les défauts

Quatorze tests faux et sept défauts invisibles aux commandes, sur vingt stories.
Répartition par ce qui les a attrapés — c'est la seule base honnête pour décider
ce qu'on garde :

| Ce qui a trouvé | Nombre | Exemples |
|---|---|---|
| **Mutation à l'endroit du défaut** | 14 | empreinte volée acceptée comme code de secours ; `robots.txt` offrant `/reset-password?token=…` ; deux écritures inter-locataires sans filet |
| **Vérification navigateur** | 7 | QR blanc sur noir illisible ; avatar remplacé invisible ; débordement à 390 px ; grille cassée par un `@source` |
| **Revue indépendante** | tous les `critical` | croisement de locataires en s18, client réabonné traité comme expiré en s19 |
| **Fusion** | 6 | `oauth` absent des segments réservés ; bloc de lint qui éteignait la porte réseau ; garde d'environnement née après ses cas |

Aucun n'a été trouvé par relecture seule. C'est pourquoi ces quatre-là ne se
négocient pas, quel que soit le niveau d'effort.

## Ce qu'on a supprimé, et pourquoi ce n'était pas de la qualité

- **Briefings de 1 500 mots** répétant l'historique complet à chaque agent. Il
  est dans `AGENTS.md` et `docs/STATE.md`, que l'agent lit de toute façon. Ce
  qu'on garde : l'invariant central **de sa** story, et ce que la story
  précédente a payé cher.
- **Revue complète après un tour de correction.** Une revue ciblée sur le delta
  coûte 104 k tokens là où la complète en coûtait 197 k, pour la même exigence.
  La revue de correction **ne refait pas** la première.
- **Opus partout.** Le modèle suit le risque de la story, pas sa taille.
- **Trois voies en parallèle.** Les trois coupures de limite d'usage sont
  arrivées à trois voies ; deux voies ne perdent pas de travail.

## Ce qui coûte le plus, et ce qu'on en fait

**1. Les tours de correction, pas les revues.** s19 : trois revues, deux
corrections. s13 : deux et deux. Les constats qui les déclenchent se répètent :

- mutation posée ailleurs qu'au **point de composition** ;
- affirmation écrite que **rien ne vérifie** ;
- garde qui ne mord que dans **une** configuration de modules.

→ **Correctif de processus** : ces trois-là entrent dans le briefing de
l'implémenteur. Ils cessent d'être découverts par le relecteur.

**2. Les fusions.** Chaque story entre en conflit sur les mêmes six fichiers :
registre de modules, `package.json`, `tests/fixtures/screen-viewer.ts`,
`tests/rendered-text.test.ts`, validation d'environnement, `AGENTS.md`. Ce sont
des **listes centrales** que chaque module doit rallonger.

→ **Correctif à faire** : rendre ces points extensibles **par ajout de fichier**
plutôt que par modification d'une liste. Une fixture par module, un fragment
d'environnement par module. Tant que ce n'est pas fait, la fusion se fait en
trois points fichier par fichier (`git merge-file`), jamais par concaténation :
la concaténation coupe au milieu d'un bloc et le typecheck le dit ensuite.

**3. La double configuration jouée localement.** Chaque agent joue les six
commandes deux fois. La CI a une matrice `tous`/`socle` : dès qu'elle tourne,
l'agent n'en joue plus qu'une.

→ **Débloqué** : le dépôt est poussé, la CI tourne.

## Ce qui reste à décider par mesure, pas par principe

- Le **document de recherche séparé** n'a de valeur que si la story explore un
  terrain neuf. Pour une variation d'un motif livré (s21 sur s20), il devient
  une section du plan.
- Les stories de **contenu** (blog, docs, changelog, roadmap) peuvent partager
  une voie et une revue : elles ne se croisent sur aucun fichier chaud.
- La **maquette HTML** ne se justifie que pour un écran qui n'a pas de gabarit.

## Journal des correctifs de processus

| Date | Constat | Correctif |
|---|---|---|
| 31/08 | Playwright réutilisait le serveur d'un autre worktree | `reuseExistingServer: false`, `E2E_PORT` par voie |
| 31/08 | La CI ne jouait qu'une configuration de modules | matrice `tous` / `socle` |
| 31/08 | Un agent tué laisse sa mutation appliquée | restaurer dans la commande qui pose |
| 01/09 | Deux voies prenaient le même numéro d'ADR sans conflit git | réservation, deux numéros par voie |
| 01/09 | Mutation déplacée annoncée « 1 rouge » alors que le défaut restait vert | mutation **à l'endroit du défaut**, vérifié en revue |
| 01/09 | Le scan de secrets aurait été rouge dès le premier jour sur des doublures | `.gitleaks.toml`, vérifié par mutation dans les deux sens |
