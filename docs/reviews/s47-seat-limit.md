# Review — Story s47-seat-limit

> Revue en contexte neuf sur `git diff dev...feature/s47-seat-limit`, commit unique. Worktree `.worktrees/s47-seat-limit`, PostgreSQL 5446, harnais rejoué en entier.
> **GitHub Actions est à l'arrêt au niveau du compte** depuis le 05/09 : tout ce qui suit est local, et la branche attend la CI comme `s30-docs-site`.

## Harnais, rejoué par la revue

`typecheck` 26/26 · `lint` propre · `test` **2086 passés / 8 sautés / 0 échec** · `build` ok · `test:e2e` **100 passés / 8 sautés** · `test:socle` **85 / 23**, arbre propre · `test:minimal-profile` **5/5**, `billing` parmi les modules coupés · `audit` propre. **Aucun des sept intermittents de s52 n'a rougi.**

**Aucun test supprimé.** Les cinq seules assertions retirées sont les réécritures du contrat `SeatSync` (`.toBe(true|false)` → `.toEqual({ok:…})`) : un changement de contrat **strictement plus fort** — le cas d'échec n'assertait qu'un `false`, il asserte désormais *lequel* des deux refus.

## Le mécanisme

`seat_limit_reached` est un **frère** de `seat_sync_unavailable` (s23) : même raccord, même moment (l'acceptation, dans la transaction, avant validation), même garantie (rien n'est écrit). Ce qui change : le raccord rend un verdict discriminé au lieu d'un booléen — deux façons de refuser n'appellent pas la même action — et porte `adds`, parce qu'un plafond ne doit **jamais** s'opposer à un retrait.

## Les cinq claims, vérifiés

1. **Le piège `ACCEPT_REFUSALS` — confirmé, et pire que réclamé.** Retirer le motif de cette liste laisse **2086 cas de nœud verts** (pas 175 : la suite *entière* est aveugle) et fait rougir **un seul cas, celui du navigateur**. C'est la justification du cas Playwright, et il asserte positivement avant de nier — donc il ne passe pas sur une page non hydratée.
2. **`exceedsSeatLimit` ne recopie pas `offerSyncsSeats`, et c'est le *type* qui l'empêche** : `offerSeatLimit` reçoit `Pick<BillingOffer,'seatLimit'>`, elle ne **peut pas** voir `perSeat` ni `mode`. Une offre à forfait plafonnée est réellement au catalogue et les cas d'intégration tournent dessus.
3. **Deux messages, ancrage prouvé.** L'assertion négative est encadrée de trois positives et d'un plancher qui empêche une locale neuve de rendre le cas vert à vide. Mutation (chaîne vidée) → 1 rouge. Les textes livrés ne nomment ni offre, ni plafond, ni chiffre, **dans les deux locales**.
4. **Personne n'est expulsé** — aucun chemin de suppression ajouté. L'aveu de l'implémenteur (« aucune mutation mordante ») est honnête mais **incomplet** : c'est vrai de la moitié « n'expulse pas », alors que l'autre moitié — **ne pas enfermer** — a deux mutations mordantes, et c'est elle qui portait le défaut atteignable.
5. **La mutation verte attrapée est bien corrigée** : le montage réécrit rend les deux mutations rouges, chacune à son site.

## Les six écarts déclarés — tous justifiés, cinq par la mesure

Le raccord élargi en résultat discriminé (forcé : un booléen aurait obligé à **inventer** le motif de l'autre côté de la transaction) · `adds` ajouté hors plan, et il empêche le critère 4 de casser **dans la direction que personne ne regarde** — un plafond abaissé refuserait les *retraits* et enfermerait l'organisation · `seatLimit: null` rendu visible dans le fichier que le propriétaire édite · une offre plafonnée à forfait ajoutée au catalogue d'essai · **la suite délègue désormais à la vraie traduction** au lieu d'en recopier une : plus forte, et mesuré — sans cette délégation, une mutation posée en production laisserait verts les cas d'intégration · un compte périmé corrigé **par retrait**, balayé par contenu.

## Findings

### M1 — **major** — un `seatLimit` sur une offre `one_time` était accepté et sans effet

Et l'argument décisif est que **le même fichier refuse déjà le cas identique, dix lignes plus bas** : `trialDays` sur une offre à achat unique, avec la raison écrite — « *une période d'essai sur un achat unique décrit une intention que rien n'exécute : le fournisseur l'ignorerait en silence* ». Un plafond sur `lifetime` est le même objet : `syncSeats` résout l'offre depuis l'**abonnement vivant**, qu'un achat unique n'a pas, donc la fonction sort avant d'avoir lu `seatLimit`. La règle est bien agnostique au mode ; c'est le **câblage** qui est abonnement-seulement. Et le champ était en vitrine sur les trois offres livrées, `lifetime` comprise.

**Fermé.** Refus ajouté au catalogue sur le précédent voisin, cas rouge d'abord, plus un second cas garantissant que `null` reste accepté sur `one_time`. Mutation → 1 rouge. Et le champ a été **retiré de l'offre à vie livrée** — le refus seul laissait l'invitation à y écrire un nombre.

### M2 — **major** — le plafond nommé ne parvenait à personne, et un commentaire affirmait le contraire

`SeatSyncOutcome` portait `{ status: 'over_limit', limit }` avec un commentaire disant que « le message qui le nomme est composé plus haut, et seulement pour un membre ». **Ce message n'existait pas** : `limit` n'était lu nulle part, et `error.seat_limit_reached` — le seul texte nommant la limite — n'est rendu par **aucun parcours**, atteignable seulement en tapant le paramètre à la main. Le propriétaire, qui est le *As a* de la story, n'apprenait jamais qu'on avait refusé quelqu'un à sa porte.

**Fermé, et par le bon geste.** Le champ est **retiré** plutôt qu'accompagné d'un commentaire véridique — produit à une ligne, lu à zéro — et la garantie qui remplace la phrase est adossée à une commande : `pnpm typecheck` échoue si quelqu'un le relit. Le message orphelin est **gardé**, avec une raison mesurée : il est **l'ancre** du cas de non-divulgation, dont l'assertion négative passerait dans le vide sans un texte de membre qui nomme le plafond. Ce qui manque n'est pas le texte mais **le canal**, et son successeur est nommé : `s32-notifications-inapp`.

### Trois mineurs, fermés

Un compte « trois issues » pour quatre, dans le fichier même que la story éditait — remède identique à celui qu'elle avait appliqué ailleurs : retirer le nombre. Une **exhaustivité fausse** (« le seul ajout de membre du module » — `createOrganization` en fait un autre), dont la conclusion tenait mais pas la prémisse ; corrigée en nommant les deux, et le tableau d'`AGENTS.md` énumère désormais **cinq** écritures au lieu d'en revendiquer quatre. Et **trois comptes de mutation sous-estimés d'une unité**, remesurés et corrigés.

### Deux mineurs signalés, non corrigés

Le **code** de refus reste visible dans la barre d'adresse de l'invité : le texte ne nomme rien, mais `?error=seat_limit_reached` dit qu'une limite existe. Cohérent avec le précédent accepté de s23, un cran en deçà de l'esprit du plan — signalé pour être su. Et `adds` est **obligatoire** sur le raccord mais **facultatif** sur les deux joints côté facturation ; l'omission y désarme le plafond en silence, ce que le commentaire assume.

## Socles

**Sécurité** : le refus n'est **pas** un 404 (`docs/security.md` §3 le réserve à la ressource d'autrui ; ici l'organisation est bien celle de l'acteur, c'est l'opération qui est refusée) · rien n'est écrit quand il tombe — effectif inchangé, aucun appel sortant, invitation toujours consommable · rien de l'offre ni du plafond n'atteint un non-membre. Zod à la frontière de configuration, message nommant l'offre **et** le champ. **Aucune brèche.**
**Fiabilité** : aucune migration, aucun changement de schéma — le plafond est de la configuration, pas de la donnée. Le plafond est évalué **avant** l'appel au fournisseur, donc l'ordre d'ADR 046 est intact. **Aucune brèche.**

## Ce qui n'a pas été vérifié

Le parcours HTTP complet du refus n'a **jamais été joué dans un navigateur** : le cas Playwright forge le paramètre au lieu de faire déborder le plafond puis de suivre la redirection · aucune vraie clé Stripe, tous les événements sont simulés · aucun rendu inspecté à l'œil ni à 390 px, alors que le message de l'invité fait ~150 caractères en français · la locale anglaise n'a été vue qu'en test de nœud · le refus au démarrage est prouvé au niveau de l'analyse du catalogue, pas en démarrant l'application avec un catalogue fautif · `pnpm test:golden-path` non exécuté · **rien n'a été observé en CI**, qui est à l'arrêt.

**Le delta du correctif n'a pas fait l'objet d'une passe de revue indépendante** : chacun de ses changements de code porte sa mutation, mesurée, et les corrections documentaires n'en portent pas — leur mode d'échec est une phrase fausse lue comme vérifiée, qu'aucune commande ne peut rougir.

Max severity: minor
Ship allowed: yes
