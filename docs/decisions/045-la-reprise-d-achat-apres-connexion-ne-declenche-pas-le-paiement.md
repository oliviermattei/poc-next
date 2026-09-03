# ADR 045 — La reprise d'achat après connexion ne déclenche pas le paiement

- Status: accepted
- Date: 2026-09-03
- Scope: story s22-pricing-page

## Context

Le critère 4 de `s22-pricing-page` demande qu'« un visiteur non connecté soit
mené à la connexion, puis au checkout ». L'offre choisie doit donc traverser
l'aller-retour d'authentification.

Le mécanisme existe déjà et il est sûr : `safeRedirectPath`
(`packages/modules/auth/src/domain/redirect.ts:17`) refuse toute cible qui ne
commence pas par une barre unique, et il **préserve la chaîne de requête**. Un
retour vers `/pricing?offer=pro-monthly` est donc transportable sans ouvrir de
redirection.

La question n'est pas le transport, c'est ce qu'on fait à l'arrivée. Ouvrir
automatiquement le tunnel de paiement **écrit** : l'ADR 034 impose que le
rattachement du client précède le checkout, et `openCheckout`
(`packages/modules/billing/src/application/billing-use-cases.ts:483-515`) crée
la session chez le fournisseur puis enregistre son `providerCustomerId`. Un
paramètre d'URL déclencherait donc un appel sortant et une écriture.

Conséquence : n'importe qui pourrait envoyer `…/pricing?offer=lifetime` à une
personne déjà connectée, et le simple fait d'ouvrir le lien créerait une session
de paiement à son nom. Aucun euro ne bouge — le paiement demande encore une
saisie — mais l'effet de bord est réel, non sollicité, et déclenché par une
navigation, c'est-à-dire par une requête que rien n'authentifie comme
intentionnelle.

## Decision

Le retour de connexion **repose l'offre, il ne l'achète pas**. `/pricing?offer=<id>`
valide l'identifiant par Zod contre le catalogue, met la carte correspondante en
évidence et donne le focus à son bouton. L'ouverture du tunnel reste un geste
explicite de la personne, exactement comme sans aller-retour.

Un `offer` absent, inconnu ou malformé est ignoré : la page s'affiche normalement,
sans erreur — c'est une préférence d'affichage, pas une ressource.

## Considered options

- **Ouvrir le checkout automatiquement au retour** — rejeté : transforme une
  navigation en effet de bord. Un lien forgé suffirait à créer une session de
  paiement et une ligne client au nom d'un tiers connecté. C'est la lecture
  littérale du critère, et c'est celle qui coûte le plus cher.
- **Porter l'intention dans un jeton signé à courte durée, lié à la session** —
  rejeté : c'est la bonne réponse à un problème qu'on n'a pas. Le coût est une
  surface cryptographique et un stockage d'intention à faire expirer, pour
  économiser **un clic** sur un bouton déjà visible à l'écran. À reconsidérer si
  une mesure montre un abandon réel à cette étape.
- **Ne rien transporter et ramener sur `/pricing` nu** — rejeté : satisfait la
  lettre du parcours mais perd le choix déjà fait. La personne doit retrouver
  l'offre qu'elle avait sélectionnée, sinon l'aller-retour lui coûte sa décision.

## Consequences

- Le parcours coûte **un clic de plus** qu'une reprise automatique. C'est le prix
  assumé, et il est payé par la seule population concernée : les visiteurs qui
  n'avaient pas de compte.
- La page de tarifs n'a **aucun effet de bord**, dans aucun état. Elle lit le
  catalogue et rend du HTML — ce qui la rend cacheable et sans risque de rejeu.
- `?offer=` devient une entrée utilisateur : elle est validée par Zod contre le
  catalogue, comme toute frontière (`docs/security.md` §4). Un test doit échouer
  si quelqu'un la lit sans la valider.
- Ce que cet ADR ne tranche pas : le parcours **sans compte préalable**, qui
  appartient à `s24-guest-checkout`.
