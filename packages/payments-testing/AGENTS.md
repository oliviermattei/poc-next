# packages/payments-testing — règles locales

**Outil de développement du port `Payments`. Ce n'est pas un fournisseur.**

C'est la phrase la plus importante de ce fichier, et elle est opposable : ADR 008
livre **une seule implémentation par port**, et cette implémentation est Stripe
(`packages/adapters/stripe`). LemonSqueezy, Polar, Creem et Dodo sont au
cimetière du PRD. Rien de ce que contient ce package ne les rend légitimes —
parce que rien ici ne parle à un service tiers.

| Outil | Ce qu'il fait | Quand |
|---|---|---|
| `createLocalPayments` | simule checkout, portail et événements de webhook, sans réseau | en développement et dans les parcours, sur demande explicite : `PAYMENTS_LOCAL_MODE=1` (`docs/reliability.md` §2) |

Il n'y a **pas** de doublure d'enregistrement ici, et c'est délibéré : en CI, les
appels sortants sont doublés **au réseau**, dans le harnais de
`@repo/adapter-stripe` et de `tests/billing.test.ts`
(`Stripe.createFetchHttpClient(fetchDouble)`). C'est ce que le dépôt exige —
« les doublures de test remplacent le réseau, jamais le SDK ». Une doublure de
port en plus n'éprouverait ni la sérialisation, ni les en-têtes, ni la
vérification de signature.

## Ce que le mode local ne réimplémente pas

`verifyWebhook` est **délégué à l'adaptateur**. Les charges utiles que ce
simulateur fabrique traversent donc exactement le code qui traitera celles du
vrai fournisseur : même vérification de signature, même normalisation. Une
seconde normalisation serait une seconde vérité, et la première à diverger
serait celle qu'aucun parcours n'exerce.

Le `fetch` injecté dans ce vérificateur **lève** : le mode local ne fait aucune
requête sortante, et si une évolution l'y amenait, elle le dirait bruyamment au
lieu d'ouvrir une connexion depuis un poste de développement.

## Ce qu'il ne simule pas — écrit plutôt que sous-entendu

Le changement d'offre et l'annulation depuis le portail, l'échec de paiement, la
fin réelle d'une période, **le remboursement d'un achat unique** et **le montant
prélevé**. Le portail local se contente de ramener dans l'application, et ces
états-là s'éprouvent par rejeu d'événements enregistrés
(`tests/billing.test.ts`), pas au navigateur.

**Aucun montant, et c'est une propriété du port** (s20) : `CreateCheckoutInput`
ne transporte ni prix ni devise — un port qui en porterait inviterait quelqu'un à
les lui passer depuis un navigateur. Le simulateur n'en invente donc pas : un
achat terminé en mode local rend `amountTotal: null`, et l'écran affiche l'achat
sans son prix. C'est la vérité de ce qu'on sait ici, pas un chiffre fabriqué.

**Le mode paiement produit un seul événement** (`checkout.session.completed`,
`mode: 'payment'`, `payment_status: 'paid'`), là où l'abonnement en produit deux
volontairement désordonnés : il n'y a pas de second objet à décrire, donc pas de
désordre à simuler.

L'état vit **en mémoire du processus** : redémarrer le serveur oublie les
sessions ouvertes. C'est un simulateur, pas une base.

## Imports autorisés

- `@repo/ports` pour le port `Payments` et ses formes ;
- `@repo/adapter-stripe`, pour lui **déléguer** la vérification et la
  normalisation ;
- `stripe`, uniquement pour **signer** une charge utile
  (`Stripe.webhooks.generateTestHeaderString`) : produire une signature à la
  main ferait diverger le simulateur du schéma réel à la première évolution ;
- `@repo/typescript-config` et `vitest`.

Aucun client HTTP, aucune lecture de `process.env` ni de `NODE_ENV` : le choix
du mode se fait au point de composition (`apps/web/lib/billing.ts`) sur la
**configuration**, et `apps/web/lib/billing-config.ts` refuse le drapeau sous
`NODE_ENV=production`.

## Ne doit jamais contenir

- **d'implémentation qui encaisse réellement** : ce serait un second adaptateur ;
- de règle métier : cet outil ne décide ni de l'accès, ni des permissions, ni de
  l'ordre d'application des événements ;
- de secret réel : le secret de webhook local n'ouvre rien d'autre que la
  simulation.

## Tests

`src/payments-testing.test.ts`, à côté du code qu'il couvre. Un seul fichier :
le coût d'une suite est dominé par le fichier, pas par l'assertion.

**Ce qui a été prouvé par mutation** (sur les 18 cas de la suite) : faire lever
le simulateur sur une session inconnue → 1 ; tirer un identifiant de client
aléatoire au lieu de le dériver du périmètre → 1 ; **signer avec l'horloge
injectée au lieu de l'horloge réelle → 6** ; rendre `payment_status: 'unpaid'`
dans la session d'achat simulée → 1 (s20).

Cette dernière n'est pas une mutation inventée : c'est le défaut que la suite a
trouvé toute seule, un jour après avoir été écrite verte. Les deux horodatages
d'un webhook ne disent pas la même chose — `created` ordonne les événements
(domaine, injectable), celui de l'en-tête de signature borne le rejeu
(transport, 300 s de tolérance). Les confondre rendait la simulation
invérifiable dès le lendemain.
