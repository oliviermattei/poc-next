# ADR 036 — Le registre des scripts non essentiels vit au point de composition, pas au contrat de module

- Status: accepted
- Date: 2026-09-02
- Scope: story s36-cookie-consent

## Context

s36 pose un mécanisme de consentement, s39 y branchera PostHog, et le critère de
s39 est explicite : « module non activé ⇒ **aucun script d'analyse déclaré**, et
la bannière ne s'affiche plus faute de script non essentiel ». La liste des
scripts doit donc **dériver des modules activés**, sans quoi couper l'analytique
laisserait une bannière qui ne protège plus rien.

Le contrat de module (ADR 007) est le mécanisme prévu pour ce genre de
déclaration : `routes`, `navigation`, `webhooks` et `jobs` y sont déclarés
précisément pour qu'un module non activé n'expose rien. Une quinzième clé
`scripts` serait la réponse naturelle.

## Decision

**Aucune clé n'est ajoutée au contrat.** Le registre des scripts non essentiels
est construit par `apps/web/lib/consent.ts`, le point de composition du
consentement — le septième du même modèle, après le mailer, l'authentification,
l'i18n, le site public, les organisations et le stockage.

s39 y ajoutera trois lignes : « module d'analytique monté ⇒ le script du
fournisseur entre dans la liste », exactement comme `lib/marketing.ts` décide de
l'existence du site public et `lib/storage.ts` de celle du stockage.

## Considered options

- **Une quinzième clé `scripts` au contrat de module** — rejetée pour deux
  raisons, et la seconde est décisive :
  1. elle oblige à rouvrir les sept modules existants pour y écrire
     `scripts: []`, ce qu'ADR 007 a précisément cherché à éviter en fixant
     toutes les clés dès le premier module ;
  2. elle rend **faux** `docs/architecture.md` et l'`AGENTS.md` racine, qui
     énumèrent les clés du contrat — deux documents de cadrage qu'une story n'a
     pas le droit de modifier. La décision appartient donc à une phase de
     cadrage, pas à une story d'implémentation.
- **Un fichier `config/consent.ts` édité par le propriétaire** — rejetée : la
  liste ne dériverait plus des modules activés, et couper le module
  d'analytique laisserait son script déclaré. Le critère de s39 deviendrait
  invérifiable.
- **Un enregistrement à l'import** (`registerScript()` appelé par le module) —
  rejetée pour la raison qui a fait choisir la déclaration pour `jobs` et
  `webhooks` : un module non activé qui se charge — et ils se chargent tous, le
  code est dans le bundle serveur (ADR 016) — enregistrerait son script.

## Consequences

**Ce qui devient facile.** s36 ne dépend d'aucune modification de cadrage. La
question « quels scripts ce déploiement déclare-t-il ? » a un seul fichier de
réponse, et il est déjà le fichier où l'on va chercher « le consentement est-il
monté ? ».

**Ce qui devient plus difficile.** Un module tiers installé dans le dépôt ne
peut pas déclarer son script tout seul : il faut une ligne dans le point de
composition. C'est le même coût que celui déjà payé par `marketing`,
`organizations` et `storage`, et il est visible — une ligne absente se voit dans
un fichier de vingt lignes, là où une clé de contrat oubliée ne se voit nulle
part.

**Ce qu'il faut surveiller.** Le jour où **plusieurs** modules déclarent des
scripts, ce fichier devient une liste de conditions. Passé trois, la question de
la clé de contrat se repose — et elle se reposera dans une phase de cadrage,
avec le droit de rouvrir `docs/architecture.md`.

**Une conséquence à connaître avant s39, mesurée sous le build de production** :
la politique de sécurité du contenu livrée par s45 porte `'strict-dynamic'` dans
`script-src`. Un navigateur qui comprend CSP niveau 3 **ignore alors `'self'` et
toute source d'hôte**. Déclarer l'origine d'un fournisseur dans
`config/security.ts` ne suffira donc **pas** à charger son script : c'est le
nonce de la requête qui l'autorise, et il est transmis par `app/layout.tsx`
jusqu'au shell. Mesuré en remplaçant le nonce par une valeur fausse : les deux
scripts sont refusés, et le navigateur le dit — « Note that 'strict-dynamic' is
present, so host-based allowlisting is disabled ».
