# ADR 036 — Le registre des scripts non essentiels vit au point de composition, pas au contrat de module

- Status: accepted
- Date: 2026-09-02

La liste des scripts non essentiels doit dériver des modules activés : couper l'analytique doit retirer son script, et la bannière de consentement disparaît quand aucun script non essentiel n'est déclaré. Une clé `scripts` au contrat de module (ADR 007) serait la réponse naturelle.

Aucune clé n'est ajoutée au contrat. Le registre est construit par `apps/web/lib/consent.ts`, point de composition du consentement : le script du module `analytics` y entre quand ce module est monté, comme `lib/marketing.ts` décide de l'existence du site public.

## Considered options

- **Une clé `scripts` au contrat de module** — rejeté : rouvre tous les modules pour y écrire `scripts: []`, pour un besoin qu'un seul module a.
- **Un fichier `config/consent.ts` édité par le propriétaire du projet** — rejeté : la liste ne dériverait plus des modules activés, et couper l'analytique laisserait son script déclaré.
- **Un enregistrement à l'import (`registerScript()`)** — rejeté : tous les modules sont chargés dans le bundle serveur (ADR 016), un module non activé enregistrerait donc son script.

## Consequences

Un module installé ne déclare pas son script seul : il faut une ligne dans le point de composition, visible dans un fichier court. Quand plusieurs modules déclareront des scripts — au-delà de trois — la question de la clé de contrat se repose, par une ADR qui remplace celle-ci.

La politique de sécurité du contenu porte `'strict-dynamic'` dans `script-src` : un navigateur CSP 3 ignore alors `'self'` et toute source d'hôte. C'est le nonce de la requête, transmis par `app/layout.tsx`, qui autorise un script ; déclarer l'origine du fournisseur dans `config/security.ts` ne suffit pas à le charger (elle reste le repli des navigateurs CSP 2). Les origines qu'il appelle, champs `connect` et `img`, restent à déclarer.
