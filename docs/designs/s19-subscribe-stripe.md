# Design — s19-subscribe-stripe · écran « Facturation »

> Dérivé de `docs/design-system.md`. **Aucun composant, aucun token inventé** :
> tout vient du baril `@repo/ui` tel qu'il existe aujourd'hui.

## Ce que l'écran doit dire

Le critère 3 et le critère 7 de la story, plus l'exigence de la mission : **trois
états distincts au minimum — sans abonnement, abonnement expiré, paiement
échoué — et l'écran doit dire lequel.** Six états sont livrés, parce que trois
seulement obligeraient à confondre « en essai » avec « actif » et « annulé mais
encore payé » avec « expiré ».

| État | Sémantique du système | Composant porteur | Ce que l'écran propose |
|---|---|---|---|
| `none` — aucun abonnement | neutre | `Badge` « Aucun abonnement » | la liste des offres |
| `trialing` — essai en cours | `info` | `Badge` + `Alert` | gérer / changer d'offre |
| `active` — abonnement actif | `success` | `Badge` | gérer |
| `ending` — annulé, accès jusqu'à la fin de la période | `muted` | `Badge` + `Alert` | reprendre par le portail |
| `past_due` — paiement en retard | `warning` | `Badge` + `Alert` | mettre à jour le moyen de paiement |
| `expired` — période terminée, accès perdu | `muted` | `Badge` + `Alert` | la liste des offres |

La correspondance est **exactement** celle que `docs/design-system.md` fixe déjà
pour s19/s21 : « essai en cours → `info`, en retard de paiement → `warning`,
annulé ou expiré → `muted`, abonnement actif → `success` ». Rien n'est ajouté.
`destructive` n'est pas utilisé : il est réservé à l'échec définitif, qui
n'existe qu'après relance (s33).

## Composition

```
PageHeader            titre + description (clés du module)
  └─ Alert            l'état, quand il demande une action (trial/ending/past_due/expired)
Card                  « Votre abonnement »
  ├─ CardHeader       CardTitle + Badge (l'état) + CardDescription (offre, période)
  └─ CardContent      bouton « Gérer la facturation » → portail  (si un client Stripe existe)
Card × n              une carte par offre déclarée dans config/billing.ts
  ├─ CardHeader       nom de l'offre + prix formaté + intervalle
  ├─ CardContent      période d'essai, facturation au siège, le cas échéant
  └─ CardFooter       bouton « Souscrire » ; abonné : Badge « Offre en cours »
                      sur la sienne, renvoi au portail sur les autres
EmptyState            à la place des cartes quand aucune offre n'est déclarée
```

**Deux précisions écrites après les revues**, parce que le code livré les tranche
autrement que la première rédaction ne le laissait croire :

- l'état `none` **n'est pas** un `EmptyState` : la carte « Votre abonnement »
  existe toujours et porte un `Badge` « Aucun abonnement ». L'`EmptyState` est
  réservé au catalogue vide — un écran sans abonnement n'est pas un écran sans
  contenu ;
- **le catalogue entier se ferme à qui a déjà l'accès**, et pas seulement la
  carte de son offre (constats F5 puis M3 des deux revues). Le pied de sa carte
  rend un `Badge` « Offre en cours » ; les autres rendent une ligne de texte
  discrète qui renvoie à « Gérer la facturation ». La raison n'est pas
  esthétique : `checkout.sessions.create({ mode: 'subscription' })` crée
  **toujours** un abonnement de plus chez le fournisseur, si bien que le bouton
  de l'autre carte ouvrait un second prélèvement — que cet écran, qui n'affiche
  que l'abonnement courant, ne montrait pas. Changer d'offre passe donc par le
  **portail**, ce que le sixième critère de la story disait déjà. Sans accès —
  abonnement expiré ou annulé —, toutes les cartes retrouvent leur bouton : c'est
  le parcours « se réabonner ».

Chaque bouton est le composant client `BillingAction` de `apps/web`
(ADR 027) : le module décide **où** il s'affiche, l'application décide
**comment** il parle au serveur.

## Interaction

- **Souscrire** : `POST /api/modules/billing/checkout` avec l'identifiant
  d'offre — jamais un prix, jamais une devise, jamais une quantité. La réponse
  porte une URL ; le navigateur y va par `window.location.assign`. Le bouton
  passe en `disabled` pendant l'appel et reste éteint tant que React n'a pas la
  main (`useHydrated`), comme partout dans ce dépôt.
- **Gérer** : `POST /api/modules/billing/portal`, même mécanique.
- **Refus** : `Alert` `destructive` au-dessus des cartes, avec la clé de refus
  traduite. Un refus de permission (`member` dans une organisation) rend le même
  message que le serveur : l'action reste **visible** et refusée — masquer un
  bouton n'est pas une permission (`docs/security.md` §3), et le design system
  dit la même chose pour les fonctionnalités réservées.
- **Sans JavaScript** : `<noscript>` explicite, comme les formulaires publics de
  s11. Le `<form method="post">` reste écrit en toutes lettres.

## Retour de paiement

Stripe renvoie sur `/billing?checkout=success` ou `?checkout=cancelled`. Le
paramètre est validé par Zod dans l'écran (énumération fermée) et rendu en
`Alert` `success` ou `info`. Il n'accorde **aucun** droit : l'état affiché vient
de la base, écrite par le webhook. Un `?checkout=success` forgé n'affiche donc
qu'un bandeau, jamais un abonnement.

## Responsive et thème

Cartes en colonne unique sous `md`, grille `md:grid-cols-2` au-delà — utilitaires
Tailwind du système, aucune couleur brute. Les six états sont lisibles dans les
deux thèmes : toutes les couleurs employées sont des tokens sémantiques définis
en clair **et** en sombre.

## Design system gaps — aucun

`PricingTable` figure au catalogue de `docs/design-system.md` mais n'est pas
construit, et il appartient à s22 (page de tarifs publique). L'écran de
facturation compose avec `Card`, ce que le système autorise explicitement
(« `Card` : unité de base des pages de paramètres »). Rien n'a manqué.
