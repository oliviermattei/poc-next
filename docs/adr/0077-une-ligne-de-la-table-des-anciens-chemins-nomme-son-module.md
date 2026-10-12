# ADR 077 — Une ligne de la table des anciens chemins nomme le module qui sert sa cible

- Status: accepted
- Date: 2026-09-29
- Scope: story s63-application-sous-app
- Amends: ADR 075 (le signal « écran servi » seulement ; la table, le proxy et le 308 restent)

## Context
ADR 075 ne redirige un ancien chemin que si l'écran cible est « servi dans la configuration », et `legacyScreenTarget` (`apps/web/lib/legacy-paths.ts:49`) lit ce fait dans la **navigation du registre** : la cible doit être le `href` d'une entrée. s63 déplace trois écrans sous `/app`, dont deux n'ont **aucune** entrée de navigation — le centre de notifications (retiré de la barre latérale par s62c, atteint par la cloche) et le parcours d'intégration (s40, atteint par la racine de l'application). Avec le signal actuel, `/notifications` et `/onboarding` ne redirigeraient jamais.

## Decision
Chaque ligne de la table porte sa cible **et l'identifiant du module qui sert cet écran** (`{ target, module }`). `legacyScreenTarget` rend la cible si et seulement si ce module est dans `registry.moduleIds` — un module coupé n'est pas dans le registre, donc son ancien chemin répond comme avant (404). Le paramètre devient `Pick<ModuleRegistry, 'moduleIds'>`. Un test exige que chaque module nommé existe dans l'annuaire des modules disponibles.

## Considered options
- **Ajouter une entrée de navigation aux deux écrans** — rejetée : elle apparaîtrait dans la barre latérale, contraire à s62c (barre réservée au produit) et à s40 (le parcours n'a pas d'entrée par décision).
- **Une nouvelle clé de contrat « écrans »** — rejetée : rouvre le contrat de module (ADR 069 : une clé optionnelle se justifie par un défaut sans propriétaire) pour une information que la table peut porter elle-même.
- **Ne plus garder du tout (rediriger toujours)** — rejetée : ADR 075 refuse un 308 vers un 404 quand le module est coupé.
- **Garder la navigation pour les lignes qui en ont une, le module pour les autres** — rejetée : deux signaux pour une même question divergent.

## Consequences
- Un écran dont le module est activé mais qui répond 404 pour une autre raison (ex. `/app/premium` quand `config/gating.ts` ne réserve plus la fonctionnalité) redirige vers ce 404 : accepté, le cas relève d'une configuration que le démarrage valide déjà.
- Déplacer un écran d'un module vers un autre oblige à changer la ligne : le test d'existence du module le rappelle.
