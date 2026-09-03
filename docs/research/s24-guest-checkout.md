# Research — Story s24-guest-checkout

## La prémisse qui se casse : l'ADR 034 interdit exactement ce que la story demande

L'ADR 034 §1 est catégorique. La ligne `billing_customer` est écrite
« **pendant l'ouverture du checkout**, avant que l'URL ne soit rendue au
navigateur — **jamais** à la réception de `checkout.session.completed` ». Le code
applique la règle sans exception : le gestionnaire de `checkout_completed`
retourne `{ kind: 'none' }` avec le commentaire « n'écrit **rien** : le
rattachement a déjà eu lieu à l'ouverture du checkout (ADR 034) »
(`billing-use-cases.ts:534-538`).

Et cette règle achète une garantie précise, écrite dans l'ADR :

> « tout événement `customer.subscription.*` résout son propriétaire par
> `provider_customer_id`, **quel que soit son ordre d'arrivée**. Le désordre de
> rattachement cesse d'exister ; il n'y a pas de tampon d'événements orphelins. »

Or un visiteur anonyme n'a **pas de compte à rattacher** au moment où le tunnel
s'ouvre, et le critère 5 interdit d'en créer un : « Un paiement abandonné ne crée
ni compte ni droit d'accès ».

Les deux ne peuvent pas être vrais ensemble par la voie évidente. Rattacher au
webhook — la solution qui vient à l'esprit — **rouvre le tampon d'événements
orphelins** que l'ADR 034 a supprimé : un `customer.subscription.created` arrivé
avant que `checkout.session.completed` soit traité n'aurait aucun propriétaire.

## La sortie : un périmètre invité au stockage, jamais dans le cœur

`billing_customer` ne porte **aucune clé étrangère** (ADR 018). Le périmètre y
est stocké en deux colonnes de texte, `scope_kind` et `scope_id`
(`packages/modules/billing/src/schema.ts:51-52`), avec deux index uniques
(`:60-61`) :

- `(scope_kind, scope_id)` — un périmètre n'a qu'un client ;
- `provider_customer_id` — un client du fournisseur n'appartient qu'à un
  périmètre.

Un périmètre `guest` est donc représentable **au stockage** sans toucher au type
`ModuleScope` de `packages/core/src/module.ts:215`, qui n'a que `user` et
`organization`. C'est important : ce type est partagé par la purge et l'export de
**tous** les modules ; y ajouter un troisième cas obligerait à rouvrir chaque
module écrit.

La ligne client peut donc être écrite à l'ouverture du tunnel comme l'exige
l'ADR 034 — avec un périmètre invité opaque — puis **promue** vers
`user:<id>` quand le compte existe. La garantie d'ordre de l'ADR 034 est
préservée : tout événement résout son propriétaire par `provider_customer_id`,
qui ne change jamais.

Et le critère 5 est tenu : un paiement abandonné laisse une ligne
`billing_customer` orpheline — qui n'est **ni un compte ni un droit d'accès**.

C'est une piste, pas une décision : le plan tranchera, et devra écrire un ADR
soit pour ce périmètre invité, soit pour l'exception au « jamais » de l'ADR 034.

## Les cinq faits structurants

1. **`openCheckout` exige une session** (`billing-use-cases.ts:542-546`) :
   `ownerOf(session)` puis `canManage(scope, session.userId)`. Le chemin invité
   ne peut pas le réemployer tel quel ; il lui faut une entrée distincte, et
   cette entrée est **publique**.
2. **Une route publique de paiement est une surface d'abus.** Le socle sécurité
   impose une limitation de débit sur **tout** point d'entrée public et de
   l'anti-automatisation sur les formulaires publics. Aujourd'hui la seule
   limitation vit dans `marketing/src/presentation/public-form-routes.ts` ; la
   route de checkout invité en aura besoin.
3. **`checkout_completed` ne fait rien aujourd'hui**, mais il est **déjà
   journalisé par identifiant d'événement** (« un rejeu ne doit pas retraverser
   la chaîne », `:536-537`). Le critère 6 s'appuie donc sur un mécanisme qui
   existe, plutôt que d'en créer un.
4. **L'unicité de `provider_customer_id`** (`schema.ts:61`) est ce qui rend le
   rejeu idempotent au niveau de la base, pas seulement au niveau du code : un
   second traitement du même événement ne peut pas fabriquer une seconde ligne.
5. **Le magic link existe** (`auth-use-cases.ts:322`, gabarit
   `auth.magic-link`) : le critère 3 se branche dessus au lieu d'inventer un
   envoi.

## Story visée

« Payer sans créer de compte d'abord ». Complexité annoncée : **3**.
Dépendances : `s22-pricing-page` (livrée), `s21-trials-and-gating` (livrée).
Exclusivité ShipSaaS parmi les quatre cibles.

Les huit critères, dont deux sont des interdits de sécurité explicites :
**aucune session ouverte depuis la page de retour** (7), et **le compte se crée
au webhook, pas au retour** — le visiteur peut fermer son navigateur.

## Pièges & contraintes

- **La page de retour ne fait foi de rien.** s19 l'a déjà posé pour l'écran de
  facturation : « Un `?checkout=success` forgé n'affiche qu'un bandeau »
  (`apps/web/app/billing/page.tsx`, en-tête). Le critère 7 étend cette règle au
  parcours invité, et c'est la même discipline — l'état vient de la base, écrite
  par le webhook.
- **Rattacher à un compte existant (critère 4) n'est pas une prise de contrôle**
  tant que rien n'est envoyé d'autre qu'un lien vers l'adresse elle-même. Le
  risque à surveiller est l'inverse : qu'un lien de définition de mot de passe
  envoyé à une adresse déjà titulaire d'un compte permette de **contourner** son
  mot de passe existant. Le comportement du lien pour un compte existant doit
  être décidé, pas hérité.
- **L'email vient du fournisseur de paiement**, donc d'une frontière : Zod, et
  aucune confiance implicite. Qu'il soit « vérifié par le paiement » est une
  affirmation du fournisseur, pas une preuve de possession de la boîte.
- **Le module `billing` n'a aucun `requires`** (ADR 034) et ne connaît pas
  `auth`. Créer un compte depuis le webhook ne peut donc pas se faire dans le
  module : ça passe par le point de composition, comme `seatsOf` et `seatSync`
  (s23).
- **Critère 8** : module coupé, aucune route de checkout anonyme ne doit
  **exister** — pas « répondre 403 ». C'est le motif déjà éprouvé des routes
  déclarées au contrat.
- Sans Postgres levé, 288 tests se sautent en silence.

## Questions ouvertes

- **Que fait le lien envoyé à une adresse qui a déjà un compte ?** Magic link
  (connexion) ou définition de mot de passe (écrasement) ? Le second est un
  chemin de réinitialisation qui contourne la possession du mot de passe actuel.
  Le critère 3 dit « définir son mot de passe **ou** se connecter par magic
  link » sans trancher.
- **Combien de temps une ligne client invitée reste-t-elle orpheline ?** Un
  paiement abandonné en laisse une. Rien ne la nettoie, et `docs/prd.md` met
  l'`eject` au cimetière — mais une rétention est déclarée par module au contrat.
- **Le périmètre invité survit-il à la promotion ?** Si oui, `(scope_kind,
  scope_id)` garde une ligne morte ; si non, la promotion est une mise à jour, et
  son idempotence doit être prouvée.
- **La limitation de débit de la route publique** : par adresse IP, par offre,
  les deux ? Le socle l'exige « partagée entre instances », ce que la
  limitation PostgreSQL existante sait faire.

## Complexité réelle

`docs/stories.md` annonce **3**. Après lecture : **4**.

Le volume est modeste — une route, un gestionnaire de webhook, un envoi d'email.
Mais la story **contredit un ADR accepté** sur le point précis qui lui donnait sa
garantie d'ordre, ouvre la **première route de paiement publique** du dépôt, et
porte deux interdits de sécurité dont la violation ne se verrait pas en
fonctionnement normal. Ce n'est pas 3.

Pas de proposition de découpe : les huit critères décrivent un seul parcours, et
le couper laisserait un chemin de paiement à moitié câblé — pire que de le
livrer entier.
