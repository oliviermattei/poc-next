# Design — s20-one-time-purchase · l'achat unique dans l'écran « Facturation »

> Dérivé de `docs/design-system.md` et du design de s19
> (`docs/designs/s19-subscribe-stripe.md`), qu'il **prolonge** — il ne le
> remplace pas. **Aucun composant, aucun token inventé** : tout vient du baril
> `@repo/ui` tel qu'il existe aujourd'hui.

## Ce que l'écran gagne, et rien de plus

s19 a livré l'en-tête, la carte « Votre abonnement » à six états, le catalogue
d'offres et l'état vide. s20 n'y touche pas. Il ajoute **une carte** et modifie
**deux règles d'affordance**.

| Ce qui change | Pourquoi |
|---|---|
| une carte « Vos achats », rendue seulement s'il y a au moins un achat | critère 2 (« visible dans la page de facturation ») et critère 4 (« l'historique des paiements reste accessible ») |
| l'offre `one_time` porte « Acheter », pas « Souscrire », et « Paiement unique » à la place d'une périodicité | critère 1 : ce n'est pas un abonnement, et le dire autrement mentirait |
| une offre unique déjà possédée rend un `Badge` « Déjà acheté » à la place de son bouton | l'invariant central : on ne facture pas deux fois le même acte d'achat |
| le bouton « Gérer la facturation » n'apparaît que s'il existe un abonnement | critère 4 : « le portail client n'est pas proposé pour un achat unique » |

## Composition

```
PageHeader            inchangé
  └─ Alert            l'état d'abonnement, inchangé
Card                  « Votre abonnement » — inchangé
  └─ CardFooter       bouton « Gérer la facturation », désormais conditionné
                      à l'existence d'un abonnement, non d'un client
Card                  « Vos achats »            ← nouveau, rendu si ≥ 1 achat
  └─ CardContent      une ligne par achat :
                        nom de l'offre (ou « offre retirée du catalogue »)
                        montant réellement prélevé + date
                        Badge  payé → success  ·  remboursé → secondary
Card × n              le catalogue, inchangé dans sa structure
  └─ CardFooter       offre abonnement : règle de s19, inchangée
                      offre unique possédée : Badge « Déjà acheté »
                      offre unique libre    : bouton « Acheter »
EmptyState            inchangé
```

### La carte « Vos achats »

Une `Card` avec `CardHeader`/`CardTitle` et un `CardContent` qui liste. Pas
d'`EmptyState` : la carte **n'est pas rendue** quand il n'y a aucun achat, comme
la carte d'abonnement ne rend pas son `CardContent` sans abonnement. Un état
vide y promettrait une action qui vit ailleurs — dans le catalogue, juste en
dessous.

Chaque ligne porte trois informations, **jamais concaténées** dans un même nœud
de texte (la règle de `tests/rendered-text.test.ts`) : le nom de l'offre, une
ligne « Acheté le {date} — {montant} » composée par une seule clé à deux
paramètres, et un `Badge`.

**Le montant affiché est celui qui a été prélevé**, pas celui du catalogue : une
offre dont le prix change ne réécrit pas le passé. C'est une donnée, formatée par
`Intl` comme le prix des offres.

### Les deux `Badge` de statut

| Statut | Variante | Libellé |
|---|---|---|
| payé | `success` | « Payé » |
| remboursé | `secondary` | « Remboursé » |

`secondary` et non `destructive` : un remboursement n'est pas une erreur du
système, c'est un état terminé — la même sémantique `muted` que
`docs/design-system.md` donne à « annulé ou expiré ». `destructive` reste
réservé à l'échec définitif.

Le libellé est porté **par le badge lui-même**, jamais par la seule couleur :
une distinction faite uniquement par la teinte n'existe pas pour qui ne la
perçoit pas. C'est la règle que la carte d'abonnement suit déjà.

### Le catalogue, mode par mode

La règle de s19 — « un abonnement vivant ferme **tout** le catalogue » — est
désormais **bornée aux offres d'abonnement**. C'est le sixième critère : un
abonné peut acheter à vie, un acheteur à vie peut s'abonner. La règle serveur
suit exactement la même frontière (`already_subscribed` ne regarde que les
abonnements, `already_purchased` que les achats) ; masquer un bouton n'est pas
une permission.

Une offre unique déjà possédée ne rend **pas** le renvoi au portail : il n'y a
rien à y gérer. Elle rend un `Badge` « Déjà acheté », qui dit pourquoi le bouton
n'est pas là.

## Interaction

- **Acheter** : le même composant client `BillingAction` que « Souscrire »
  (ADR 027), sur la même route `POST /api/modules/billing/checkout`, avec le
  **seul** identifiant d'offre. Le serveur choisit `mode: 'payment'` d'après le
  catalogue ; le navigateur n'envoie ni prix, ni mode, ni montant. Le
  `<form method="post">` reste écrit en toutes lettres, et le bouton reste éteint
  tant que React n'a pas la main.
- **Refus** : `Alert` `destructive` au-dessus de la carte, avec la clé traduite.
  Un second achat de la même offre rend « Vous possédez déjà cet achat » — et
  l'action reste **visible et refusée** côté serveur pour qui n'a pas la
  permission.
- **Retour de paiement** : inchangé. `?checkout=success` n'accorde rien ; l'achat
  n'apparaît que lorsque le webhook l'a promu.

## Responsive et thème

Rien de nouveau : la carte « Vos achats » est une `Card` pleine largeur, ses
lignes sont empilées, et tous les `Badge` employés existent déjà en clair et en
sombre. Vérification au navigateur à 390 px et 1440 px, dans les deux thèmes.

## Design system gaps — aucun

Aucun composant n'a manqué. `Card`, `CardHeader`, `CardTitle`, `CardContent`,
`Badge` : tout est au catalogue. `PricingTable` reste non construit et reste la
matière de s22.
