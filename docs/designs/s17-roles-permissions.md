# Design — s17-roles-permissions

Dérivé de `docs/design-system.md`. **Aucun composant ni token inventé** : tout
vient du baril `@repo/ui` déjà copié et déjà utilisé par l'écran
(`Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `Badge`,
`Button`, `Input`, `Label`, `Alert`, `EmptyState`, `PageHeader`, `OrgSwitcher`,
`Separator`) et des tokens sémantiques (`bg-background`, `text-muted-foreground`,
`border-border`, `bg-card`). Maquette de référence :
`docs/designs/s17-roles-permissions.html` — une référence, pas du code.

s17 n'ajoute **aucun bloc** à l'écran. Elle en retire, selon le rôle, et ajoute
des affordances sur des lignes qui existent déjà.

---

## 1. Le principe : l'écran ne connaît aucune règle

`OrganizationsView` porte déjà `members[].removable`, calculé **côté serveur**
par la règle du `domain`. s17 étend exactement ce patron, et n'en invente pas un
autre :

| Donnée servie | Ce que l'écran en fait |
|---|---|
| `view.permissions` — un booléen par action sensible | affiche ou non la carte / le formulaire / le bouton |
| `members[].removable` | affiche ou non le bouton de retrait de **cette** ligne |
| `members[].assignableRoles` — les rôles que l'appelant peut poser sur **cette** ligne | un bouton de soumission par rôle, aucun si la liste est vide |

**L'écran ne compte pas les propriétaires, ne compare pas deux rôles, ne teste
jamais `role === 'owner'`.** Une condition de rôle écrite dans le `.tsx` ferait
exister la matrice à deux endroits, et le second serait celui qui ment. C'est
aussi ce qui rend l'affichage juste par construction : masquer un déclencheur
n'est pas une permission (`docs/security.md` §3), c'est ne pas promettre ce
qu'on va refuser — le serveur refuse de toute façon, en **403**.

---

## 2. `/organizations`, vu par chaque rôle

L'ordre des blocs ne change pas : *où suis-je* → *qui est là* → *qui arrive* →
*comment ça s'appelle* → *en créer une autre*.

| # | Bloc | `owner` | `admin` | `member` |
|---|---|---|---|---|
| 1 | `PageHeader` | ✓ | ✓ | ✓ |
| 2 | `Alert` `destructive` du refus | ✓ | ✓ | ✓ |
| 3 | Carte « Organisation courante » | ✓ | ✓ | ✓ |
| 4 | Carte « Membres » | ✓ | ✓ | ✓ (liste seule) |
| 5 | Carte « Invitations » | ✓ | ✓ | **absente** |
| 6 | Carte « Paramètres » | ✓ | ✓ | **absente** |
| 7 | Carte « Créer une organisation » | ✓ | ✓ | ✓ |

Deux décisions à justifier :

- **la carte « Membres » reste visible pour un `member`**, sans aucun bouton
  sinon « Quitter l'organisation » sur sa propre ligne. Savoir avec qui l'on
  partage ses données n'est pas un privilège, et une carte vide serait un écran
  cassé — `docs/design-system.md`, § États ;
- **la carte « Créer une organisation » reste visible pour tous** : créer une
  organisation à soi n'est pas une action sur celle-ci. Le rôle n'y entre pas.

Une carte entière disparaît plutôt que d'être grisée : le design system réserve
« l'action reste visible mais mène à une invitation à souscrire » au **gating
d'offre** (s21), pas à une permission. Un `member` ne peut rien acheter pour
devenir `admin`.

---

## 3. La carte « Membres », ligne par ligne

La forme de la ligne est inchangée — c'est le composant `Row` de l'écran, dont
le libellé prend sa propre ligne sous `sm` (`basis-full sm:flex-1
sm:basis-auto`), acquis du constat F5 de la revue de s16.

```
[ adresse du membre ]  [Badge rôle] [Badge « Vous »]  [Admin] [Membre] [Propriétaire] [Retirer]
```

Au plus quatre affordances, et **jamais quatre à la fois** : `assignableRoles`
exclut le rôle courant de la ligne, et la propriété ne s'offre que sur une ligne
qui n'est pas la sienne. Le tableau a changé d'une case au tour de correction de
s17 : un `admin` ne retire plus un autre `admin` — le critère 3 dit « retirer des
*members* », et le laisser faire ouvrait une prise de pouvoir latérale entre
pairs (revue, arbitrage 2).

| Vu par | Sur la ligne d'un `member` | Sur celle d'un `admin` | Sur celle d'un `owner` | Sur sa propre ligne |
|---|---|---|---|---|
| `owner` | Admin · Propriétaire · Retirer | Membre · Propriétaire · Retirer | Admin · Membre · Retirer | Quitter (si un autre propriétaire existe) |
| `admin` | Retirer | *(rien)* | *(rien)* | Quitter |
| `member` | *(rien)* | *(rien)* | *(rien)* | Quitter |

Chaque bouton est un `<form method="post">` autonome — `method` écrit en toutes
lettres, `pnpm lint` le refuse autrement — avec `organizationId`, `userId` et,
pour un changement de rôle, `role` en champs cachés. Aucun composant client, donc
aucune fenêtre pré-hydratation : la soumission native **est** le chemin nominal.

**Pourquoi des boutons et pas un `Select`.** `Select` figure à l'inventaire de
`docs/design-system.md` mais n'est pas copié dans `packages/ui`. L'y copier
demanderait un composant client portalisé (Radix), donc un repli `<noscript>`
comme celui d'`OrgSwitcher`, sur un écran qui n'a aujourd'hui qu'une seule
exception de ce genre — et pour un besoin que deux boutons couvrent entièrement.
Ce n'est **pas** un design system gap : le besoin est couvert par `Button`.

**Deux libellés par bouton**, comme les boutons de s16 : le texte visible est
court (« Admin »), le nom accessible nomme sa cible (« Nommer marie@… administrateur »).
Trois boutons « Admin » sur trois lignes sont indiscernables au clavier comme
pour une aide technique ; mettre l'adresse **dans** le bouton le rendrait
indéformable et ferait déborder l'écran à 390 px — mesuré en s16, 1033 px de
contenu.

**Le transfert de propriété est le seul bouton `variant="outline"`** ; les autres
restent `ghost`. Il change qui gouverne l'organisation et rétrograde celui qui
clique : il mérite d'être distinct sans être `destructive`, qui reste réservé à
la suppression. Aucun `ConfirmDialog` : le design system le réserve aux actions
**irréversibles**, et un transfert se refait dans l'autre sens tant que le
nouveau propriétaire est de bonne foi. C'est écrit ici pour que ce soit une
décision et pas un oubli.

---

## 4. Les états et les refus

- **Refus de permission (403)** : il n'a pas d'écran. Le déclencheur est absent
  pour qui n'a pas le droit ; seul un appel direct à l'API l'atteint, et il reçoit
  un 403 JSON. Y ajouter une page serait décrire à l'attaquant ce qu'il a raté.
- **Refus métier (303 + `?error=`)** : rendu par l'`Alert` `destructive`
  existante du bloc 2. Deux motifs neufs, avec leur clé de catalogue :
  `last_owner` (existant, réemployé pour la rétrogradation) et `invalid_role`
  (le rôle demandé n'est pas un rôle du produit).
- **Vide** : inchangé. La carte « Membres » n'est jamais vide — l'appelant en est
  membre.
- **Succès** : le 303 ramène sur l'écran, et le `Badge` de rôle de la ligne a
  changé. Un changement d'état visible, pas de `Toaster` — le design system
  demande l'un ou l'autre, jamais les deux.

---

## 5. Responsive et thème

Rien de neuf : la ligne est le `Row` de s16, dont le comportement sous `sm` a été
mesuré au navigateur (largeur rendue du libellé ≥ 200 px à 390 px, adresse courte
non tronquée, débordement horizontal nul). s17 ajoute **au plus deux boutons**
par ligne dans le même conteneur `flex-wrap` : la vérification à refaire est donc
celle du retour à la ligne des affordances, aux deux thèmes et à 390 px.

Section « Vérification visuelle » remplie à l'exécution, avec les nombres
mesurés — pas de case cochée sans trace (constat F6 de la revue de s15).

---

## Vérification visuelle — mesurée, pas déclarée

Sonde Playwright **jetable** (créée, exécutée, supprimée — arbre vérifié propre
après), Chromium, `next dev` sur `E2E_PORT=3117`. Une organisation à deux, vue
par son propriétaire, avec une adresse de membre volontairement longue
(`s17-adresse-tres-longue-<uuid>@example.test`, 58 caractères) : la ligne porte
donc le libellé, deux badges, deux boutons de rôle et le bouton de retrait.

| Écran | Largeur | Thème | Débordement horizontal | Largeur rendue du libellé | Fond `<body>` |
|---|---|---|---|---|---|
| `/organizations` (vu par `owner`) | 1280 | clair | **0 px** | **628 px** | `lab(100 0 0)` |
| `/organizations` (vu par `owner`) | 1280 | sombre | **0 px** | **628 px** | `lab(2.75381 0 0)` |
| `/organizations` (vu par `owner`) | 390 | clair | **0 px** | **308 px** | `lab(100 0 0)` |
| `/organizations` (vu par `owner`) | 390 | sombre | **0 px** | **308 px** | `lab(2.75381 0 0)` |
| `/organizations` (vu par `member`) | 390 | clair | **0 px** | — | — |

Ce que ces nombres disent, et ce qu'ils ne disent pas :

- **le débordement horizontal reste nul aux deux largeurs et dans les deux
  thèmes**, avec deux affordances de plus par ligne qu'en s16 ;
- **l'acquis du constat F5 de s16 tient** : à 390 px le libellé garde 308 px de
  large, soit toute la ligne moins ses marges — on lit encore de qui l'on change
  le rôle. Avant la correction de s16, la mesure équivalente était de 8,98 px ;
- les deux fonds relevés sont ceux des deux thèmes du design system : ils sont
  bien appliqués, et aucune couleur Tailwind brute n'entre dans le module ;
- **le membre ne voit pas la carte d'invitation** : la sonde compte
  `cartesInvitation=0` sur son écran à 390 px, contre une pour le propriétaire.

**Non vérifié**, dit plutôt que sous-entendu, et ce n'est pas la liste de ce qui
existe : aucun lecteur d'écran réel, aucun calcul de contraste, un seul moteur
(Chromium), et le parcours **au clavier seul** n'a pas été rejoué sur les boutons
de rôle. Geste humain attendu : parcourir `/organizations` à la tabulation avec
trois membres, et vérifier que les trois boutons d'une même ligne s'annoncent
distinctement.
