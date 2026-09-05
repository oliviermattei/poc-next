---
validated: yes
---
# Plan — Story s47-seat-limit

Branch: `feature/s47-seat-limit`
Research: `docs/research/s47-seat-limit.md` (**sur `dev`**) — **à lire d'abord** : le mécanisme existe déjà, s23 a posé `seat_sync_unavailable`, un refus d'origine facturation déclenché à l'acceptation.

## Target story

Cinq critères : une limite configurable sur une offre, une offre sans limite restant illimitée · le refus **côté serveur**, avec un message **nommant la limite atteinte** · le refus porte sur l'**acceptation**, pas sur l'envoi · une limite abaissée sous l'effectif **n'expulse personne** · **module de facturation non activé** : aucune limite.

## Les cinq décisions que ce plan prend

La recherche laisse cinq questions ouvertes, dont trois sont des décisions de produit. Les trancher ici évite qu'elles se décident au premier sens venu pendant l'écriture.

1. **La limite vit sur l'offre**, comme le critère 1 le dit. Une organisation qui change d'offre prend la limite de la nouvelle, **sans effet rétroactif** : si la nouvelle plafonne sous l'effectif, personne ne part, les ajouts suivants sont refusés. C'est le critère 4 appliqué à un changement d'offre plutôt qu'à un abaissement.
2. **La limite s'applique quel que soit le mode de l'offre.** **Ne pas recopier la condition de `offerSyncsSeats`** (`perSeat && mode === 'subscription'`) par symétrie : elle existe parce qu'un achat unique n'a pas d'abonnement à corriger. Un **plafond**, lui, a du sens sur un forfait — c'est même son cas d'usage le plus courant.
3. **Deux messages, et c'est une décision de sécurité.** Celui qui accepte une invitation **n'est pas membre** de l'organisation : lui nommer la limite de l'offre d'un tiers révèle quelque chose de cette organisation. Il reçoit donc un refus qui **ne nomme pas l'offre ni le plafond** ; le propriétaire, lui, voit la limite nommée. Le critère 2 est ainsi tenu pour qui doit agir, sans divulgation à qui n'a pas à savoir.
4. **Sans offre courante, aucune limite.** Une organisation en essai ou dont l'abonnement a expiré n'a pas d'offre d'où tirer un plafond : elle n'est pas plafonnée. C'est cohérent avec le critère 5 — module coupé, aucune limite — et le contraire ferait dépendre l'ajout d'un membre d'un état de facturation transitoire.
5. **Plusieurs invitations en attente peuvent dépasser ensemble.** Aucune ne dépasse seule, le premier accepteur prend la place, les suivants sont refusés avec le motif. C'est la conséquence directe du critère 3 (le refus porte sur l'acceptation), et elle doit être **écrite** — sinon le comportement paraîtra arbitraire.

## Tasks (ordered)

1. [x] **Cas rouge d'abord — le plafond au contrat d'offre.** Un neuvième champ sur `BillingOffer`, **facultatif** : une offre sans plafond reste illimitée (critère 1). Zod à la frontière de `config/billing.ts`, comme le reste de cette configuration. **Test qui peut échouer** : une offre plafonnée, une offre sans plafond, une valeur invalide refusée en nommant l'offre.
2. [x] **La règle, dans le domaine et pure.** « Cet effectif, ce plafond → accepte ou refuse. » Elle vit à côté de `offerSyncsSeats` et `billableSeats` dans `packages/modules/billing/src/domain/seats.ts`, **sans reprendre leur condition de mode** (décision 2). Trois cas au moins : sous le plafond, à égalité, au-dessus. **Test qui peut échouer** : les trois, plus l'absence de plafond.
3. [x] **Le motif de refus, dans les deux listes.** Un quatorzième code dans `INVITATION_REFUSALS` **et** dans `ACCEPT_REFUSALS` — le refus tombe à l'acceptation, donc l'écran d'acceptation doit savoir le dire. **Piège nommé par la recherche** : `ACCEPT_REFUSALS` est la liste contre laquelle le paramètre `?error=` est validé ; l'oublier rendrait le motif **muet à l'écran sans qu'aucun test ne rougisse**. **Test qui peut échouer** : le motif rendu à l'écran d'acceptation.
4. [x] **Le refus à l'acceptation, côté serveur.** Sur le motif de `seat_sync_unavailable` (s23), au même endroit du parcours. **Ne pas répondre 404** : `docs/security.md` §3 le réserve à la ressource d'autrui, or l'organisation est bien la sienne — c'est l'opération qui est refusée, même raisonnement que s21 pour une fonctionnalité réservée. **Test qui peut échouer** : une acceptation au-delà du plafond est refusée, une en dessous passe.
5. [x] **Les deux messages** (décision 3). Le propriétaire voit la limite nommée ; l'invité reçoit un refus qui ne nomme ni l'offre ni le plafond. **Test qui peut échouer** : le message de l'invité **ne contient pas** le plafond — une assertion négative ancrée par une assertion positive sur ce qu'il contient, sinon elle passerait sur une chaîne vide.
6. [x] **N'expulser personne, jamais** (critère 4). Une limite abaissée sous l'effectif laisse tous les membres en place. **Test qui peut échouer** : effectif au-dessus du plafond, aucun membre retiré, et l'ajout suivant refusé.
7. [x] **Module de facturation coupé : aucune limite**, par dérivation et non par condition sur un nom de module — motif `EMPTY_*` du dépôt. **Test qui peut échouer** : `pnpm test:socle` et `pnpm test:minimal-profile`, où `billing` est coupé.
8. [x] **Passage complet.** `typecheck`, `lint`, `test`, `build`, `test:e2e`, `test:socle`, `test:minimal-profile`, `run audit`. Comptes rapportés, intermittents connus nommés sans être corrigés.

## Run interdicts

- **Ne pas répondre 404 sur ce refus.** `docs/security.md` §3 réserve le 404 à la ressource d'autrui.
- **Ne pas expulser, ni retirer, ni désactiver un membre.** Le cimetière du PRD refuse tout ce qui supprime des données hors d'un `eject` explicite.
- **Ne pas recopier la condition de `offerSyncsSeats`** (décision 2).
- **Ne pas divulguer l'offre ni le plafond à qui n'est pas membre** (décision 3).
- **Ne pas oublier `ACCEPT_REFUSALS`** : le motif y serait muet sans qu'un test rougisse.
- **Ne pas corriger les sept intermittents connus** — ils appartiennent à s52 ; les nommer s'ils rougissent, ne pas se les attribuer.
- **Ne pas toucher `docs/killer-saas-feedback.md` ni `docs/research/`** : ils vivent sur la branche par défaut.

## The point everything turns on

**Le refus porte sur l'acceptation, et il vient de la facturation.** s23 a déjà posé ce chemin exact avec `seat_sync_unavailable`, y compris le raisonnement sur pourquoi un tel refus ne doit pas se confondre avec « lien invalide ». La story ajoute un frère à ce motif ; si elle en construit un second mécanisme, c'est qu'elle s'est trompée.

Trois endroits où ça peut être faux :

1. **Le motif pourrait être muet à l'écran.** À comparer : `ACCEPT_REFUSALS` est la liste de validation du paramètre `?error=` — un cas doit rendre le motif à l'écran, pas seulement le produire côté serveur.
2. **La limite pourrait ne s'appliquer qu'aux offres au siège.** À comparer : `offerSyncsSeats` et la règle nouvelle doivent avoir des conditions **différentes**, et un cas doit couvrir une offre à forfait plafonnée.
3. **Le message de l'invité pourrait fuiter.** À comparer : une assertion négative seule passe sur une chaîne vide ; il faut l'ancrer sur ce que le message contient réellement.

## Files touched

`packages/modules/billing/src/domain/offer.ts` et `seats.ts` · `config/billing.ts` · `packages/modules/organizations/src/domain/invitation.ts` (les deux listes) et son parcours d'acceptation · les catalogues de messages des deux modules · les tests · le plan.

## Test strategy

**La règle** : unitaire, dans le domaine, sans base — c'est une fonction pure de deux nombres. **Le refus** : au niveau de l'application, là où s23 éprouve `seat_sync_unavailable`. **Les deux messages** : unitaires, avec l'assertion négative ancrée. **Le module coupé** : par les recettes existantes. **L'écran d'acceptation** : un parcours navigateur, parce que le motif muet est précisément ce qu'un test unitaire ne verrait pas.

## Definition of Done

- Les huit tâches cochées, chacune avec sa mutation posée **à l'endroit du défaut** et son compte de rouges.
- Le harnais complet vert, comptes rapportés, intermittents connus nommés.
- Les cinq décisions ci-dessus **écrites dans le code**, là où le prochain agent les lira — pas seulement dans ce plan.
- Un commit unique, message impératif en français, portant le plan.

## Note d'exécution — ce que la story ne livre pas (revue, constat M2)

**La décision 3 n'est tenue qu'à moitié.** Elle promettait « le propriétaire,
lui, voit la limite nommée ». Le code ne le fait pas, et il ne peut pas le
faire ici :

- le motif `seat_limit_reached` naît à `acceptInvitation`, donc pour l'**invité**,
  dont l'écran affiche délibérément le texte vague — c'est l'autre moitié de la
  décision 3, celle-là tenue et mesurée ;
- le message qui **nomme** la limite, `organizations.error.seat_limit_reached`,
  n'est donc rendu par aucun parcours. Il n'est atteint qu'en tapant
  `?error=seat_limit_reached` à la main sur `/organizations` ;
- le nombre lui-même ne sort pas du module : `SeatSyncOutcome.over_limit` ne le
  porte plus (il n'était lu nulle part, et le commentaire qui annonçait son
  lecteur a été corrigé).

**Prévenir le propriétaire demande un canal que cette story n'a pas.** Une
notification dans l'application est `s32-notifications-inapp` ; un email sort du
périmètre. Rien n'a donc été construit ici : c'est `s32-notifications-inapp` qui
fermera l'écart, et elle trouvera le texte déjà écrit et déjà éprouvé comme
ancre de non-divulgation (`tests/organizations.test.ts`).

**Le message est gardé, pas supprimé** — la raison est écrite dans
`packages/modules/organizations/src/domain/invitation.ts`, au-dessus de
`INVITATION_REFUSALS`.

## Note d'exécution — passe de correction

Deux majeurs et trois mineurs de `docs/reviews/s47-seat-limit.md`, fermés sur
cette même branche et dans le même commit :

- **M1** — un `seatLimit` non nul sur une offre `one_time` est désormais
  **refusé au démarrage**, en nommant le champ, sur le précédent de `trialDays`
  dix lignes plus haut. La règle pure reste aveugle au mode (décision 2) : c'est
  le catalogue qui refuse, parce que c'est le **câblage** qui est propre à
  l'abonnement. `config/billing.ts` n'expose plus le champ sur l'achat unique ;
- **M2** — voir la note ci-dessus ; commentaire rendu vrai, champ mort retiré,
  écart nommé ;
- **mineurs** — « Trois issues » retiré (il y en a quatre), la fausse
  exhaustivité de `drizzle-organization-repositories.ts` et de
  `packages/modules/organizations/AGENTS.md` corrigée (cinq écritures
  d'appartenance, pas quatre : celle du fondateur manquait), et les trois
  comptes de mutation sous-estimés d'une unité re-mesurés puis réécrits **avec
  le nom des cas**.
