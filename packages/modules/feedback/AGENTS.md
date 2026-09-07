# packages/modules/feedback — règles locales

Le **retour depuis l'application** (s43) : un formulaire authentifié, une table,
et la liste que le back-office lit.

## Ce que ce module n'est pas, et c'est le point

**Il n'est pas un panneau flottant**, et ce n'est pas une commodité
d'implémentation : trois faits mesurés l'interdisent, et ils sont écrits ici
parce qu'un agent qui ne les trouve pas réinventera le bouton flottant.

1. **La politique de sécurité du contenu ne porte `'unsafe-inline'` sur
   `style-src` qu'en développement.** Un élément positionné par attribut `style`
   ou animé par une feuille injectée à l'exécution est donc **refusé en
   production et silencieux en développement** — le pire des deux mondes pour un
   défaut.
2. **`Dialog`, `Popover` et `Tooltip` sont déclarés par `docs/design-system.md`
   et absents de `packages/ui`.** Composer avec l'un d'eux **ne compile pas**.
   `Select` et `RadioGroup` le sont aussi : c'est pourquoi la catégorie est
   portée par le bouton qui soumet (`<button type="submit" name="category">`),
   du HTML natif, et non par un champ de choix. Le manque est **reporté**, pas
   comblé — une story qui a besoin de l'un d'eux le livre dans `packages/ui`
   (copie shadcn/ui sur Radix, ADR 022) et corrige la note datée.
3. **La bannière de consentement, posée en surface fixe sans réserver sa place,
   a intercepté les clics de dix parcours** — 241 px de haut à 390 px de large.
   Un visiteur ne pouvait pas atteindre le bas de la page : la bannière était
   accidentellement modale.

Le critère 1 de la story dit « accessible **depuis** le tableau de bord », pas
« superposé au tableau de bord ». Le déclencheur est donc une **entrée de
navigation** déclarée au contrat, et le formulaire une page à lui. Il fonctionne
sans JavaScript, il n'a aucun état à hydrater, et il ne peut intercepter le clic
de personne.

**Il n'émet rien non plus.** Le critère 3 veut une notification aux superadmins
« via le centre de notifications s'il est activé, par email sinon » : ce repli
est **déjà livré** (`apps/web/lib/notifications.ts`), décidé par la valeur et non
par une condition sur un nom de module, et le type `feedback.received` est une
ligne de `config/notifications.ts`, qui est du socle (ADR 057). Ce module
**nomme l'événement qu'il possède** (`FeedbackAnnouncer`) et reçoit l'annonce du
point de composition. `emails: []` au contrat est donc voulu : un texte déclaré
ici disparaîtrait avec le module, c'est-à-dire exactement dans la configuration
où le repli doit fonctionner.

## Imports autorisés

- `@repo/core` (contrat de module, répartiteur), `@repo/ui` (composants),
  `drizzle-orm` (schéma et requêtes), `zod` (frontières), `react` en pair, et
  `@repo/typescript-config` pour la configuration du compilateur.
- **Jamais un autre module** : `requires` est la seule dépendance inter-modules
  déclarée, et elle ne donne pas le droit d'importer.

## Ne doit jamais contenir

- de règle métier hors de `domain/` ;
- de lecture d'environnement (`docs/security.md` §5) : l'organisation active et
  l'annonce sont **reçues** du point de composition ;
- de clé étrangère : voir `src/schema.ts` — une cascade effacerait les lignes
  sans passer par `purge`, où l'effacement est observable ;
- d'appel réseau : `eslint.config.ts` le refuse hors d'une porte bornée.

## Les deux frontières qui décident

Elles vivent dans `src/domain/feedback.ts`, et ce sont des fonctions pures :

| Fonction | Ce qu'elle tient | Ce qui rougit si on la neutralise |
|---|---|---|
| `parseOriginPath` | **l'URL d'origine est une donnée du client** : elle arrive d'un champ caché, elle est réduite à un chemin interne borné, et rien d'autre n'entre en base | `src/domain/feedback.test.ts`, groupe `parseOriginPath` |
| `parseFeedbackSubmission` | la catégorie appartient à un vocabulaire **fermé**, le message est taillé et borné | `src/domain/feedback.test.ts`, groupe `parseFeedbackSubmission` |

## La route déclare sa limitation, et elle doit

`POST /feedback/submit` est `authenticated`. `routeIsRateLimited` (`@repo/core`)
limite **toute** route publique par dérivation, et une route non publique
**seulement si elle le demande** : sans `rateLimit: { policy: 'feedback' }`,
cette route ne serait comptée par personne. Une session n'est pas une limite —
un compte suffirait à écrire du texte libre en boucle et à faire partir un email
par passage. `tests/feedback.test.ts` le mesure sur le registre construit.

## Tests

`src/**/*.test.ts` pour les règles pures ; ce qui traverse les packages — le
registre, la limitation, le repli de notification, les écrans — vit dans
`tests/feedback.test.ts`.
