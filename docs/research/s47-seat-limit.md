# Research — Story s47-seat-limit

> Vérifiée contre `dev` au commit `dac80d4`, en lecture seule. Aucun worktree, aucune base, aucun conteneur — la recherche lit des fichiers.

## Les cinq faits structurants

1. **Le précédent exact existe déjà, posé par s23.** `packages/modules/organizations/src/domain/invitation.ts` porte `seat_sync_unavailable` : un refus **d'origine facturation**, déclenché **à l'acceptation** d'une invitation, avec un commentaire qui explique pourquoi il ne doit pas se confondre avec « lien invalide » — « dire "lien invalide" à quelqu'un dont l'invitation est parfaitement vivante l'enverrait en demander une nouvelle, indéfiniment ». s47 ajoute un frère à ce motif, elle n'invente pas un mécanisme.
2. **Les motifs de refus sont deux listes écrites, et la seconde est une frontière de sécurité.** `INVITATION_REFUSALS` en compte **treize** ; `ACCEPT_REFUSALS` en est un **sous-ensemble écrit**, et le commentaire dit pourquoi : « le paramètre `?error=` de cet écran est validé contre celle-ci, si bien qu'un code d'un autre parcours n'y affiche rien ». Le nouveau motif doit entrer dans **les deux** — le refus tombe à l'acceptation, donc l'écran d'acceptation doit savoir le dire.
3. **Une offre n'a aucune notion de limite aujourd'hui.** `BillingOffer` déclare `id, mode, priceId, amount, currency, interval, trialDays, perSeat` — huit champs, aucun plafond. Les trois offres de `config/billing.ts` portent toutes `perSeat: false`. La limite est donc un **neuvième champ**, à poser sur l'offre.
4. **`offerSyncsSeats` ne s'applique qu'aux abonnements par siège**, et c'est une décision écrite : `offer.perSeat && offer.mode === 'subscription'`, parce qu'« un achat unique n'a aucun abonnement à corriger ». Une limite de sièges, elle, n'a pas la même condition — une offre à forfait peut parfaitement plafonner son équipe sans facturer au siège. **Ne pas recopier la condition de `offerSyncsSeats` par symétrie** serait le premier piège.
5. **Le refus porte sur l'acceptation, pas sur l'envoi**, et la story le dit — cohérent avec s23, où une invitation en attente n'est pas facturée. Conséquence non écrite dans la story : **plusieurs invitations en attente peuvent dépasser la limite ensemble** alors qu'aucune ne la dépasse seule. C'est le premier accepteur qui prend la place ; les suivants sont refusés. À écrire, sinon le comportement paraîtra arbitraire.

## Target story

Une limite configurable sur une offre, une offre sans limite restant illimitée · le refus **côté serveur**, avec un message nommant la limite atteinte · le refus porte sur l'**acceptation**, pas sur l'envoi · une limite abaissée sous l'effectif existant **n'expulse personne**, elle refuse les ajouts suivants · **module de facturation non activé** : aucune limite n'est appliquée.

Dépendances déclarées : `s23-seat-billing`, `s17-roles-permissions` — les deux fusionnées.

## Points d'ancrage

- `packages/modules/billing/src/domain/offer.ts:29-51` — la forme d'une offre, où le champ de limite atterrit.
- `packages/modules/billing/src/domain/seats.ts` — `offerSyncsSeats` et `billableSeats`, les deux règles de s23. La limite est une **troisième** règle, voisine mais indépendante.
- `packages/modules/organizations/src/domain/invitation.ts:124-160` — les deux listes de motifs, et le précédent `seat_sync_unavailable`.
- `config/billing.ts:36-71` — les trois offres livrées, toutes `perSeat: false`.
- `docs/security.md` §3 — le 404 est réservé à la ressource d'autrui ; ici l'organisation est bien la sienne, seule l'opération est refusée.

## Pièges & contraintes

- **Ne pas répondre 404.** La note de la story le dit et `docs/security.md` §3 le confirme : le 404 protège la ressource **d'autrui**. Ici l'organisation appartient bien à celui qui agit — c'est l'opération qui est refusée, pas la ressource qui est cachée. Même raisonnement que s21 pour une fonctionnalité réservée.
- **Ne pas expulser.** Une limite abaissée sous l'effectif est le cas destructeur, et la story l'interdit explicitement. C'est aussi cohérent avec le cimetière du PRD, qui refuse tout ce qui supprime des données sans `eject`.
- **Ne pas recopier la condition de `offerSyncsSeats`.** Voir le fait 4 : le plafond et la synchronisation de quantité répondent à des questions différentes.
- **Module `billing` coupé : aucune limite.** Le motif du dépôt est la valeur vide qui fait tout le travail, pas une condition sur un nom de module.
- **Le message doit nommer la limite atteinte** — et rester un message d'organisation, pas une fuite d'information de facturation vers un membre qui n'y a pas droit. Qui voit le message est une question ouverte.
- **`INVITATION_REFUSALS` et `ACCEPT_REFUSALS` sont des listes écrites.** Ajouter un motif sans l'inscrire dans la seconde le rendrait muet à l'écran d'acceptation — et le test qui valide `?error=` ne rougirait pas, puisqu'il valide *contre* la liste.

## Questions ouvertes

- **La limite vit-elle sur l'offre, ou sur l'organisation ?** Le critère dit « configurée sur une offre ». Mais une organisation peut changer d'offre : la limite la suit-elle, et que se passe-t-il si la nouvelle offre plafonne plus bas que l'effectif ? Le critère « n'expulse personne » suggère la réponse, il ne la dit pas.
- **Une limite s'applique-t-elle aux offres à forfait, ou seulement à celles au siège ?** Voir le fait 4. Non tranché par la story.
- **Qui voit le message ?** Celui qui accepte l'invitation n'est pas membre de l'organisation : lui nommer la limite de l'offre d'un tiers révèle quelque chose de cette organisation. Le propriétaire, lui, doit le savoir. Deux messages, ou un seul volontairement vague côté invité ?
- **Sans abonnement actif, quelle limite ?** Une organisation en essai, ou dont l'abonnement a expiré, n'a pas d'offre courante évidente. s21 a posé les habilitations ; leur articulation avec un plafond n'est pas écrite.
- **Plusieurs invitations en attente qui dépassent ensemble** : le premier accepteur passe, les suivants sont refusés. À confirmer comme voulu.

## Complexité réelle

Notée **2** dans `docs/stories.md`, sur une recherche de s23 qui la décrivait comme « une règle d'autorisation locale, sans état distribué entre deux systèmes ». **Ma note : 2, confirmée** — le mécanisme existe, le précédent est écrit, et la règle est pure.

La difficulté n'est pas dans le code : elle est dans les **cinq questions ouvertes**, dont trois sont des décisions de produit (où vit la limite, qui voit le message, quelle limite sans abonnement) que le plan devra trancher plutôt qu'implémenter au premier sens venu.

Pas de proposition de découpe.
