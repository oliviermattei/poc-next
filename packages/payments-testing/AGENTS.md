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
| `simulatedCheckoutEvents` | les formes d'événement **écrites à la main** — la source par défaut de `createLocalPayments` | partout où la fidélité au fournisseur n'est pas le sujet |
| `createRecordedCheckoutEvents` | rejoue des formes **enregistrées** chez le fournisseur, jetons remplis par l'exécution | régime enregistré (s25) : `PAYMENTS_RECORDED_EVENTS=<dossier>` |
| `sanitizeStripeEvent` | l'inverse : un événement réel devient un enregistrement versionnable, identifiants remplacés par des jetons | à la capture, `GOLDEN_PATH_PAYMENTS=live` |
| `readCapturedEvents` | lit les événements **bruts** à capturer : un fichier NDJSON (`stripe listen --print-json`) ou un dossier de `.json` ; un chemin absent est refusé en le nommant | à la capture |

**Les deux sources se distinguent dans ce qu'elles émettent**, et pas seulement
dans le code qui les construit : `SIMULATED_EVENT_ID_PREFIX` (`evt_local_`) et
`RECORDED_EVENT_ID_PREFIX` (`evt_rec_`) partent dans l'identifiant de chaque
événement, que la route de webhook écrit dans son journal d'idempotence. C'est
ce qui permet à `pnpm test:golden-path` d'exiger un **signal positif** du régime
qu'il a demandé, au lieu de faire confiance à la transmission d'une variable
d'environnement (constat F1 de la revue de s25). Les deux marques doivent rester
distinctes ; `src/recorded-events.test.ts` le vérifie sur les deux producteurs.

Il n'y a **pas** de doublure d'enregistrement du **réseau** ici, et c'est
délibéré : en CI, les appels sortants sont doublés **au réseau**, dans le harnais
de `@repo/adapter-stripe` et de `tests/billing.test.ts`
(`Stripe.createFetchHttpClient(fetchDouble)`). C'est ce que le dépôt exige —
« les doublures de test remplacent le réseau, jamais le SDK ». Une doublure de
port en plus n'éprouverait ni la sérialisation, ni les en-têtes, ni la
vérification de signature.

Ce qui vit ici depuis s25 est autre chose : le **rejeu d'événements entrants**,
c'est-à-dire l'autre moitié de la règle des deux régimes. Et il porte un
interdit, ADR 048 :

> **Un enregistrement absent fait échouer l'exécution en le nommant. Il n'existe
> aucun repli du régime enregistré vers le simulateur.**

`createRecordedCheckoutEvents` n'a aucune branche de secours : chaque appel
commence par exiger son enregistrement. Le simulateur garde son emploi — le
développement local, les parcours qui n'ont pas besoin de fidélité au
fournisseur — et n'est **jamais substitué** à un enregistrement manquant. Un
repli laisserait la CI verte en ayant cessé de vérifier ce qu'elle prétend
vérifier, et un simulateur ne peut pas détecter sa propre dérive : le jour où le
fournisseur renomme un champ, il reste vert pendant que la production casse.

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

**La quantité au siège s'applique à toutes les lignes** (s23), et c'est la
divergence assumée entre ce simulateur et l'adaptateur : `updateSubscriptionQuantity`
écrit `input.quantity` sur **chaque** ligne de l'abonnement simulé, là où
`@repo/adapter-stripe` **refuse** un abonnement qui n'en porte pas exactement une
(`invalid_request` — deviner laquelle porte les sièges facturerait la mauvaise).
La divergence est inatteignable aujourd'hui : le simulateur ne fabrique qu'une
seule ligne. Elle le deviendrait le jour où il en fabriquerait deux, et c'est
alors le refus du vrai fournisseur qu'il faudrait simuler, pas la boucle.

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
- `@repo/typescript-config` et `vitest` ;
- `node:fs` et `node:path`, pour **lire** un dossier d'enregistrements. C'est la
  seule entrée-sortie de ce paquet, et elle est locale : aucun réseau.

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

`src/payments-testing.test.ts` pour le simulateur,
`src/recorded-events.test.ts` pour le régime enregistré — à côté du code qu'ils
couvrent. Deux fichiers, et pas plus : le coût d'une suite est dominé par le
fichier, pas par l'assertion.

**Ce que le second protège** (ADR 048) : qu'un enregistrement absent lève en
nommant l'événement et le dossier, que rien ne soit rendu à sa place, qu'un
jeton qu'aucune valeur ne remplit refuse plutôt que de partir vers la route de
webhook, et que l'**aller-retour** « assainir puis rejouer » tienne. Ce
dernier cas a trouvé un défaut le jour où il a été écrit : `sanitizeStripeEvent`
produisait `{{requestId}}` et `{{idempotencyKey}}`, que le rejeu ne savait pas
remplir.

**Ce qui a été prouvé par mutation**, sur `src/payments-testing.test.ts` — le
fichier est nommé plutôt que compté : le compte écrit ici était faux dès la
story suivante (constat F7 de la revue de s25). Faire lever le simulateur sur
une session inconnue → 1 rouge ; tirer un identifiant de client aléatoire au
lieu de le dériver du périmètre → 1 ; **signer avec l'horloge injectée au lieu
de l'horloge réelle → 6** ; rendre `payment_status: 'unpaid'` dans la session
d'achat simulée → 1 (s20). Sur `src/recorded-events.test.ts` : remplacer un
enregistrement manquant par une forme simulée → 3 (s25).

Cette dernière n'est pas une mutation inventée : c'est le défaut que la suite a
trouvé toute seule, un jour après avoir été écrite verte. Les deux horodatages
d'un webhook ne disent pas la même chose — `created` ordonne les événements
(domaine, injectable), celui de l'en-tête de signature borne le rejeu
(transport, 300 s de tolérance). Les confondre rendait la simulation
invérifiable dès le lendemain.
