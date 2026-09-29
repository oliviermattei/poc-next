# Design — Story s64b2-hote-tarifs

> **Écran dérivé** : `/pricing` (`PricingTable`) et `/app/settings/billing` (`BillingScreen`) existent. Pas de maquette ; vérification au navigateur en fin d'Execute. Aucun composant ni jeton nouveau.

## Écarts
### `/pricing` (site) — seulement quand le site et l'application ont des origines distinctes
- Sous le tableau des offres, une ligne de texte discret (`text-muted-foreground`, `text-sm`) : « Déjà client ? **Choisissez votre offre depuis votre espace** » — le fragment en gras est un lien texte (même style que les liens du site), vers `/app/settings/billing` (+ `?offer=<id>` si une offre est reposée par `?offer=`).
- Les boutons des offres ne changent pas (checkout invité).
- Sans `APP_HOST` : aucun changement visible.

### `/app/settings/billing` (application)
- `?offer=<id>` d'une offre du catalogue : le bouton de cette offre reprend le focus à l'hydratation (`focusOnReady`, patron ADR 045). Rien d'autre ne change à l'écran. Offre inconnue : ignorée.
- Visiteur anonyme : la redirection vers la connexion conserve l'offre dans `next`.

## States
- Offre inconnue / absente : écran inchangé. Retour `?checkout=success|cancelled` : bandeaux existants. Mobile et thèmes : texte et lien existants, rien de neuf à vérifier au-delà du retour à la ligne.

## Design system gaps
Aucun.
