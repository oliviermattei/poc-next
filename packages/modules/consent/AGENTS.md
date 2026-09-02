# packages/modules/consent — règles locales

Le module de consentement aux cookies non essentiels (s36). Il décide **ce que
l'application a le droit de charger**, et rien d'autre.

Trois propriétés commandent tout le reste de ce fichier :

1. **Il ne persiste rien** (ADR 035). `schema: {}`, `migrations: null`,
   `dataCategories: []`, `retention: {}`, `purge` et `export` à vide. Le choix
   d'un visiteur vit dans un cookie sur l'appareil de ce visiteur. L'enregistrer
   côté serveur demanderait d'attribuer un identifiant persistant à un anonyme —
   le pister pour noter son refus d'être pisté — et le lier à un compte
   priverait de leur choix ceux qui n'en ont pas.
2. **Il ne déclare aucun requis, et il est socle.** Le pied de page appartient au
   module `marketing`, qui est optionnel. Déclarer `marketing` en requis rendrait
   le consentement indisponible sur une installation qui coupe le site public —
   exactement la non-conformité relevée par le finding F57 de la revue des
   stories. Le couplage va dans l'autre sens : c'est le module qui apporte un
   script non essentiel (s39) qui déclarera `requires: ['consent']`.
3. **Il n'a pas d'état « éteint » propre** : il est inerte par construction
   quand aucun script non essentiel n'est déclaré. Aucune bannière, aucun
   cookie, rien d'injecté. C'est l'état livré du boilerplate.

## Imports autorisés

- `@repo/core` — le contrat de module, `qualifyMessageKey`, le préfixe de
  montage des routes ;
- `zod` — à la frontière : le corps d'une soumission **et la valeur du cookie**,
  qui est une entrée contrôlée par le client au même titre qu'un corps de
  requête (`docs/security.md` §4) ;
- `@repo/ui` — dans `src/presentation/` uniquement : c'est le design system, et
  la seule frontière avec le socle de composants. Un import de `@radix-ui/*` ici
  est refusé par `pnpm lint` (ADR 022) ;
- `lucide-react` — le jeu d'icônes unique du produit, 20 px ; une seule icône
  ici, celle de l'état vide de l'écran de préférences. La bannière n'en porte
  aucune : une icône décorative dans une région d'annonce est du bruit pour un
  lecteur d'écran ;
- `react` — déclaré en `peerDependencies`, donc fourni par l'application ; dans
  `src/presentation/` uniquement, le `domain` ne connaît aucun framework
  (ADR 006, vérifié par `pnpm lint`) ;
- `@repo/typescript-config` pour la configuration du compilateur.

Pas de `@repo/db` (ADR 020) et rien à en faire : ce module n'a pas de table. Pas
de `@repo/ports` : il n'appelle aucun service extérieur. Pas de `next` : il ne
connaît ni le routeur, ni les composants serveur de l'application.

## Ne doit jamais contenir

- **de table, de migration ou d'écriture en base.** Le jour où quelqu'un veut
  « garder une trace des consentements », c'est un ADR qui supersède le 035, pas
  une colonne ;
- **de texte affiché écrit en dur** : tout passe par une clé de
  `src/domain/message-keys.ts`, et les clés composées — catégorie, statut —
  passent par une fonction nommée, jamais par un gabarit écrit dans un `.tsx` ;
- **de `<form>` sans `method` écrit en toutes lettres** : `pnpm lint` le refuse,
  et ici la conséquence serait pire qu'ailleurs — le repli du navigateur est un
  `GET`, qui n'écrirait aucun cookie et rendrait le refus silencieusement
  inopérant ;
- **de composant qui exige JavaScript pour fonctionner.** Toute la surface de ce
  module est un formulaire natif : c'est ce qui fait que refuser les cookies
  marche sans script. Une case à cocher portée par une primitive Radix, un
  bouton qui appelle `fetch`, un état React qui décide de la soumission
  casseraient cette propriété sans qu'aucun test unitaire ne le voie —
  `e2e/consent.spec.ts` a un contexte `javaScriptEnabled: false` pour cela ;
- **de connaissance d'un fournisseur.** Le module ne sait pas ce qu'est PostHog.
  Il reçoit une liste de `NonEssentialScript` du point de composition de
  l'application (`apps/web/lib/consent.ts`), et c'est là que s39 ajoutera sa
  ligne — **et là seulement**. Un script réellement tiers n'a **rien** à
  déclarer dans `config/security.ts` **pour un navigateur CSP 3** : la politique
  livrée porte `'strict-dynamic'`, qui lui fait ignorer `'self'` et toute source
  d'hôte. La source d'hôte reste le **repli** des navigateurs CSP 2 — Safari
  avant 15.4 —, et `connect` comme `img` restent à déclarer dans tous les cas. C'est le **nonce** de la requête, porté par
  `ConsentScripts`, qui autorise la balise. Mesuré sous le build de production
  (ADR 036, revue de s36, constat C2) : avec un nonce faux le script est refusé
  quelle que soit la liste d'origines, et le navigateur le dit — « *Note that
  'strict-dynamic' is present, so host-based allowlisting is disabled* ».
  `'strict-dynamic'` ne vaut que pour `script-src` : ce que s39 devra bien
  déclarer dans `config/security.ts`, ce sont les origines que le fournisseur
  **appelle**, champs `connect` et `img`.

## Ce que la garde d'origine couvre, et ce qu'elle ne couvre pas

`domain/request-guard.ts` refuse une soumission dont l'`Origin` — à défaut, le
`Referer` — porte un hôte différent de celui de la requête. **Balayé** : les
deux en-têtes présents, l'un ou l'autre seul, aucun des deux, un schéma
différent (terminaison TLS), et une valeur présente qui n'est pas une URL. Cinq
cas, énumérés dans `src/domain/consent.test.ts`.

`domain/request-guard.ts` sépare deux cas que le premier jet confondait, et la
distinction est la correction du constat C1 de la revue de s36 :

- **absent** — ni `Origin` ni `Referer` : la requête est **acceptée**, et c'est
  un choix. Un attaquant ne peut pas faire *retirer* `Origin` au navigateur
  d'une victime, donc refuser ne fermerait aucune attaque, tandis que certains
  outils de confidentialité les suppriment chez des visiteurs qui sont
  précisément ceux que cet écran sert ;
- **présent mais pas une URL**, au premier chef `Origin: null` : la requête est
  **refusée**. Un `<iframe sandbox="allow-forms">`, un document `data:` ou une
  chaîne de redirections inter-origines font émettre cette valeur par le
  navigateur de la victime. Traitée comme une absence, elle laissait forger un
  consentement complet — mesuré sur le serveur de production.

Le **premier en-tête présent décide** : un `Origin` opaque n'est pas rattrapé
par un `Referer` de bonne mine, les deux venant du même appelant.

**Non couvert** : tout ce qui n'est pas un en-tête de provenance. Ce n'est pas
un jeton anti-CSRF, et `docs/security.md` n'en demande pas ici.

## Tests

- `src/domain/consent.test.ts` : les règles pures — quelle catégorie autorise
  quel script, ce que vaut un cookie illisible, ce qu'une origine étrangère
  obtient, où une redirection a le droit de renvoyer ;
- `tests/consent.test.ts` à la racine : ce qui traverse les packages — le
  contrat au registre, la route, le point de composition, et **les deux points
  d'accès dans les deux configurations du module `marketing`** ;
- `e2e/consent.spec.ts` : le navigateur — ce qui part réellement sur le réseau
  avant le choix, ce qui s'exécute après, et le tout sans JavaScript.
