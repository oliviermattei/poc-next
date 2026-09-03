# Événements Stripe enregistrés — le régime que la CI rejoue

**État de ce dossier au 2026-09-03 : aucun enregistrement.** Ce n'est pas un
oubli, c'est la conséquence écrite d'avance dans
[ADR 048](../../../docs/decisions/048-un-enregistrement-absent-fait-echouer-la-ci-jamais-de-repli-sur-le-simulateur.md) :
« La CI ne peut pas passer sans enregistrements. Les produire est donc un
prérequis de cette story — et cela demande une exécution contre les clés de test
réelles, c'est-à-dire un geste humain avec des secrets que le harnais n'a pas. »

`GOLDEN_PATH_PAYMENTS=recorded pnpm test:golden-path` **échoue donc aujourd'hui**,
en nommant les trois natures manquantes. C'est le comportement voulu : il
n'existe aucun repli vers le simulateur.

> **Ce dépôt n'a jamais été éprouvé contre les formes réelles de Stripe, et une
> CI verte ne le prouve pas.** Le job `parcours-dore` de `.github/workflows/ci.yml`
> est armé sur une **donnée** : un job sonde y cherche un fichier
> (`hashFiles('tests/fixtures/stripe-events/*.json')`, appelé au niveau d'une
> **étape** — le seul niveau où GitHub l'autorise, un `if:` de job étant évalué
> avant tout `checkout`), et le parcours dépend de sa réponse. Il ne s'exécute
> donc pas tant que ce dossier ne porte aucun enregistrement, et il devient
> bloquant à la première capture versionnée. Tant que vous lisez cette ligne,
> tout ce que la CI a vérifié du paiement est ce que **nous** avons écrit
> nous-mêmes.

## Ce qu'est un enregistrement, et ce qu'il n'est pas

Un enregistrement est une **forme d'événement capturée chez le fournisseur**,
assainie avant d'être versionnée. Il n'est pas une charge utile fabriquée par
nous : `packages/payments-testing/src/checkout-events.ts` fait cela très bien, et
c'est précisément ce qui ne peut pas détecter sa propre dérive — le jour où
Stripe renomme un champ, ajoute une contrainte ou change une forme, un simulateur
reste vert pendant que la production casse.

Ce qu'un enregistrement apporte n'est **pas** l'actualité : il fige la forme du
jour où il a été pris, et sa `capturedAt` est là pour qu'on sache quand la
reprendre. Ce qu'il apporte est qu'un changement de **notre** lecture devienne
visible sur un objet que nous n'avons pas écrit.

## Les trois natures attendues

Elles sont déclarées par `GOLDEN_PATH_EVENT_KINDS`
(`packages/payments-testing/src/recorded-events.ts`) — jamais recopiées ici, sans
quoi cette liste mentirait au premier ajout :

| Fichier | Ce qu'il porte |
|---|---|
| `subscription.checkout-completed.json` | `checkout.session.completed`, `mode: subscription` |
| `subscription.created.json` | `customer.subscription.created` |
| `purchase.checkout-completed.json` | `checkout.session.completed`, `mode: payment` |

## La forme d'un fichier

```json
{
  "kind": "subscription.created",
  "capturedAt": "2026-09-03",
  "capturedFrom": "clés de test Stripe — identifiants et horodatages assainis (ADR 048)",
  "event": { "id": "{{eventId}}", "created": "{{createdAt}}", "…": "…" }
}
```

Les jetons `{{…}}` remplacent les identifiants et les horodatages du compte de
test ; le rejeu les remplit avec ceux de l'exécution. Ce qui est versionné est la
**forme** — ce qui dérive —, pas des identifiants, qui n'apprennent rien et
exposent un compte réel.

Un jeton qu'aucune valeur ne sait remplir **fait échouer le rejeu** en le
nommant : `{{…}}` livré tel quel à la route de webhook serait une chaîne
parfaitement valide, donc un défaut silencieux de plus.

## Comment les capturer

Le geste demande vos clés — le harnais ne les a pas.

```sh
# 1. le tunnel de webhooks, dans un terminal à part. `stripe listen` imprime le
#    secret de webhook du tunnel : il sert au processus qui **reçoit** les
#    événements, pas à la commande ci-dessous.
stripe listen --forward-to http://localhost:3110/api/modules/billing/webhook \
  --print-json > /tmp/evenements.ndjson

# 2. les clés éprouvées, puis les événements bruts assainis et versionnés
GOLDEN_PATH_PAYMENTS=live \
STRIPE_SECRET_KEY=sk_test_… \
STRIPE_LIVE_PRICE_ID=price_… \
GOLDEN_PATH_CAPTURE_FROM=/tmp/evenements.ndjson \
  pnpm test:golden-path
```

**Les deux variables exigées sont celles que la recette lit** : `STRIPE_SECRET_KEY`
et `STRIPE_LIVE_PRICE_ID`, celles de
`packages/adapters/stripe/src/stripe-live.test.ts`. Le refus réclamait autrefois
un secret de webhook que rien n'employait, et se taisait sur l'offre — poser
exactement ce qui était demandé échouait alors plus loin (constat F3 de la revue).

`GOLDEN_PATH_CAPTURE_FROM` accepte **le fichier NDJSON écrit ci-dessus** (une
ligne JSON par événement, ce que `--print-json` produit) **ou** un dossier
contenant un fichier `.json` par événement brut. Un chemin qui n'existe pas est
refusé en le nommant. `sanitizeStripeEvent` déduit la nature de chaque
événement, remplace les identifiants par des jetons et écrit le fichier ici,
avec sa date.

**Ce que la capture ne fait pas** : elle n'exécute pas le scénario du parcours
doré contre Stripe. `GOLDEN_PATH_PAYMENTS=live` éprouve les clés et capture les
formes ; il ne clone rien, ne crée aucune base et n'ouvre aucun navigateur. Le
critère 7 de la story demandait davantage, et l'écart est écrit dans
`docs/plans/s25-golden-path-e2e.md` plutôt que masqué.

Le régime `live` est **refusé en CI** et refuse une clé qui n'est pas
`sk_test_…` : aucun paiement n'est encaissé par ce harnais.

## Quand les reprendre

ADR 048 ne tranche pas la fréquence, et ce fichier ne va pas l'inventer. Ce qui
est certain : la date ci-dessus est le seul repère, et un enregistrement dont la
`capturedAt` a vieilli n'est pas faux — il est simplement muet sur ce que le
fournisseur a changé depuis.
