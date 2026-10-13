# ADR 045 — La reprise d'achat après connexion ne déclenche pas le paiement

- Status: accepted
- Date: 2026-09-03

Quand un visiteur passe par la connexion avant de payer, l'offre choisie traverse l'aller-retour dans `?next=/pricing?offer=<id>` (`safeRedirectPath` préserve la chaîne de requête). Ouvrir le checkout automatiquement à l'arrivée écrirait : `openCheckout` crée une session chez le fournisseur et rattache le client (ADR 034). Un lien forgé `…/pricing?offer=lifetime` suffirait alors à créer une session de paiement au nom d'une personne connectée, sur une simple navigation.

Le retour de connexion **repose l'offre, il ne l'achète pas** : `/pricing?offer=<id>` valide l'identifiant par Zod contre le catalogue, met la carte en évidence et donne le focus à son bouton. Ouvrir le tunnel reste un geste explicite. Un `offer` absent, inconnu ou malformé est ignoré sans erreur : c'est une préférence d'affichage, pas une ressource. Depuis le paiement invité (ADR 047), ce chemin ne sert plus qu'au repli quand le canal anonyme est saturé (`guestFallbackUrl`, `apps/web/lib/billing.ts`) ; la règle est la même.

## Considered options

- **Porter l'intention dans un jeton signé lié à la session** — rejeté : une surface cryptographique et un stockage d'intention à faire expirer pour économiser un clic sur un bouton déjà visible.
- **Ramener sur `/pricing` nu** — rejeté : la personne perdrait le choix qu'elle avait fait.

## Consequences

La page de tarifs n'a aucun effet de bord dans aucun état : elle lit le catalogue et rend du HTML.
