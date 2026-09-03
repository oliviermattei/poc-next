# Research — Story s22-pricing-page

## Les cinq faits structurants

1. **Le catalogue est déjà lisible sans session.** `billingCatalogue()`
   (`apps/web/lib/billing-catalogue.ts:33`) rend le catalogue validé et
   mémorisé, sans monter la base, le SDK ni le point de composition. Une page
   publique de tarifs n'a rien à construire : elle lit cette fonction.
2. **Le navigateur n'envoie jamais un prix.** `checkoutBodySchema`
   (`packages/modules/billing/src/presentation/billing-routes.ts:41`) est un
   `z.strictObject({ offerId, locale? })` : un corps portant un montant, une
   devise ou un `priceId` est **refusé**, pas ignoré. Le serveur résout
   `offer.priceId` au catalogue (`billing-use-cases.ts:484`). La divergence que
   le critère 2 redoute ne peut donc pas venir du client.
3. **Le lien disparaît par déclaration, pas par condition.** Le module
   `marketing` porte son unique entrée publique dans son contrat
   (`packages/modules/marketing/src/module.ts:25`), commentée « c'est elle qui
   disparaît avec le module, sans qu'aucun composant ne porte de condition ».
   L'entrée « tarifs » appartient au même mécanisme, côté `billing`.
4. **`billingNavigation` n'a aujourd'hui qu'une entrée, et elle est
   `authenticated`** (`billing-routes.ts:191-199`, `protection: { level:
   'authenticated' }`). Le critère 6 demande une seconde entrée, **publique**.
   Rien de public n'existe encore dans ce module.
5. **La route de checkout est `authenticated`** (`billing-routes.ts:86`), et
   elle refuse en 403 sans session. Le critère 4 ne peut donc pas être servi en
   pointant le CTA anonyme vers le checkout : il passe par la connexion.

## Prémisse — ce que le critère 2 peut et ne peut pas prouver

Le critère dit : « Les prix affichés sont ceux envoyés au checkout ; un test
compare les deux sources et échoue en cas de divergence. »

Les deux sources existent et sont **une seule** : l'affichage lira `amount` /
`currency` de l'offre, le checkout enverra le `priceId` de la **même** offre,
toutes deux issues de `config/billing.ts`. Un test qui, pour chaque offre
rendue, vérifie que l'`offerId` du CTA résout vers l'offre dont le montant est
affiché, est écrivable et il rougira si quelqu'un introduit une seconde liste.

Ce que ce test **ne prouve pas**, et il ne faut pas le laisser croire :
`config/billing.ts:18-21` déclare que « `priceId` est ce qui fait foi. `amount`
et `currency` ne servent qu'à l'affichage : ce qui est facturé est le prix chez
le fournisseur ». Un `amount: 2900` en regard d'un prix Stripe à 39 € affiche un
mensonge que **rien en local ne peut détecter** — les deux valeurs sont
cohérentes entre elles et fausses ensemble. La divergence réellement dangereuse
est locale ↔ fournisseur, et elle est hors de portée d'un test unitaire.

Ce n'est pas une fausse prémisse — le critère est satisfaisable tel qu'écrit —
mais sa portée est plus étroite que sa formulation. Le plan doit choisir : soit
il l'assume et l'écrit dans le fichier de configuration, soit il ajoute une
vérification contre le fournisseur, qui relève du régime « clés de test réelles
hors CI » (AGENTS.md, intégrations tierces).

## Story visée

`s22-pricing-page` — « Comparer les offres et choisir ». Complexité annoncée : 2.
Dépendances : `s10-marketing-site`, `s20-one-time-purchase` — toutes deux
livrées, ainsi que `s21-trials-and-gating`.

Critères d'acceptation :
1. Page dérivée de `config/billing.ts` : ajouter une offre la fait apparaître
   sans modifier la page.
2. Prix affichés = prix envoyés au checkout, avec un test de non-divergence.
3. `subscription` et `one_time` toutes deux présentables, périodicité adéquate.
4. Visiteur connecté → checkout ; non connecté → connexion, puis checkout.
5. Traduite dans les locales livrées quand l'i18n est activée.
6. Module `billing` coupé : la page n'existe pas, le lien disparaît.

## État actuel du code

| Fichier | Ce qu'il fait aujourd'hui |
|---|---|
| `config/billing.ts:34-72` | trois offres : `pro-monthly`, `pro-yearly` (`subscription`, `trialDays: 14`), `lifetime` (`one_time`, `interval: null`) |
| `apps/web/lib/billing-catalogue.ts:33` | `billingCatalogue()` — catalogue validé, mémorisé, sans dépendance runtime |
| `apps/web/lib/billing.ts:267` | `billing.available` : le booléen qui décide de l'existence |
| `apps/web/app/billing/page.tsx:50-51` | `if (!billing.available) notFound()` puis redirection `?next=` si anonyme |
| `packages/modules/billing/src/domain/offer.ts:189` | `formatOfferPrice({amount, currency}, locale)` via `Intl.NumberFormat` |
| `packages/modules/billing/src/domain/offer.ts:170-174` | `offerForPrice`, `offerById` |
| `apps/web/app/billing-actions.tsx:1` | `'use client'` — le CTA passe par `fetch`, donc exige JavaScript |
| `packages/modules/billing/src/messages/{en,fr}.json` | 55 clés, dont `navigation.billing` |

## Points d'ancrage

- **La page** : `apps/web/app/pricing/page.tsx` (à créer), sur le modèle exact
  de `app/billing/page.tsx` — `notFound()` sur `!billing.available`, mais
  **sans** la redirection de session : la page est publique.
- **L'écran** : `packages/modules/billing/src/presentation/` — un composant
  exposé par le second point d'entrée `@repo/module-billing/presentation`
  (ADR 024). Le barrel principal ne doit jamais réexporter un `.tsx`.
- **La navigation** : une seconde entrée dans `billingNavigation`
  (`billing-routes.ts:191`), `protection: { level: 'public' }`, avec sa clé
  `navigation.pricing` dans les deux catalogues du module.
- **Le catalogue** : `billingCatalogue()`, pas `billing.view()` — cette
  dernière exige une session.

## APIs vérifiées

| Symbole | Signature réelle | Emplacement |
|---|---|---|
| `billingCatalogue` | `() => BillingCatalogue` | `apps/web/lib/billing-catalogue.ts:33` |
| `formatOfferPrice` | `(price: Pick<BillingOffer,'amount'\|'currency'>, locale: string) => string` | `offer.ts:189` |
| `offerById` | `(catalogue, id) => BillingOffer \| null` | `offer.ts:174` |
| `parseBillingCatalogue` | `(value: unknown) => BillingCatalogue` | `offer.ts:119` |
| `billing.available` | `boolean` | `apps/web/lib/billing.ts:72` |
| `checkoutBodySchema` | `z.strictObject({ offerId, locale? })` | `billing-routes.ts:41` |

`BillingOffer` porte `id`, `mode`, `priceId`, `amount`, `currency`, `interval`,
`trialDays`, `perSeat` (`offer.ts:27`). `interval` et `trialDays` sont `null`
pour `one_time` — le catalogue refuse au démarrage l'inverse.

## Pièges & contraintes

- **Le CTA exige JavaScript.** `config/billing.ts:28-36` l'assume : ouvrir le
  checkout par soumission de formulaire imposerait d'ajouter
  `checkout.stripe.com` à `config/security.ts`, ce que l'ADR 027 refuse. La page
  publique de tarifs hérite de cette contrainte et doit porter le même
  `<noscript>` que `BillingAction`.
- **Tout `<form>` déclare `method` en littéral** (règle transverse, mesurée en
  s08) : sans lui, un formulaire React retombe en GET avant hydratation et met
  les champs dans l'URL.
- **Le retour après connexion** : le motif `?next=` existe
  (`billing/page.tsx:58`), mais il ramène vers un **chemin**. Reprendre le
  checkout sur une offre précise demande de transporter l'`offerId` — c'est le
  seul mécanisme que la story doit inventer, et le critère 4 en dépend.
  `s24-guest-checkout` traite le cas sans compte préalable : ne pas empiéter.
- **L'i18n est vérifiée par test** : une clé ajoutée dans une locale et absente
  d'une autre fait échouer `pnpm test`, pas la page en production.
- **Le harnais exige une base joignable.** Les gardes d'inertie de
  `tests/organizations.test.ts:2524` et `tests/storage.test.ts` échouent
  bruyamment sans Postgres, tandis que `auth`/`billing`/`marketing` se sautent en
  silence via `skipIf`. Sans `docker compose up -d`, 288 tests disparaissent sans
  le dire.
- **`packages/modules/billing/AGENTS.md`** doit suivre si la surface publique du
  module change (une entrée de navigation publique en est une).

## Questions ouvertes

- **Le chemin de la page** : `/pricing` ou `/tarifs` selon la locale ? Le module
  `i18n` porte un routage localisé (`apps/web/lib/locale-routing.ts`) que cette
  recherche n'a pas ouvert.
- **Le transport de l'`offerId` à travers la connexion** : paramètre dans
  `next`, ou état serveur ? Un `next` porteur d'un identifiant est une entrée
  utilisateur qui finira dans une redirection — elle devra être validée par Zod
  et bornée au catalogue, sans quoi c'est une redirection ouverte.
- **La place du lien** : en-tête public, pied de page, ou les deux ? s36 a tranché
  que deux points d'accès concurrents pour un même document divergent (F57).
- **La périodicité affichée** pour `pro-yearly` : « 290 €/an » ou « 24,17 €/mois
  facturé annuellement » ? La seconde est une division que personne ne valide
  aujourd'hui.

## Complexité réelle

`docs/stories.md` annonce **2**. Après lecture : **3**.

L'écart tient à un seul critère. Les cinq autres sont du branchement sur des
mécanismes déjà en place et éprouvés — catalogue validé lisible sans session,
`notFound()` sur `available`, navigation déclarative, `formatOfferPrice`,
discipline i18n tenue par un test. Le critère 4, lui, demande un mécanisme qui
n'existe pas : reprendre un checkout sur une offre nommée **après** un aller-
retour par la connexion. Il traverse trois modules (`billing`, `auth`, `i18n`),
il introduit une entrée utilisateur dans une redirection — donc une surface de
redirection ouverte à border — et c'est le seul endroit où la story peut créer
une faille plutôt qu'une page.

Pas de proposition de découpe : 3 reste une story.
