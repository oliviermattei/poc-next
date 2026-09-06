# ADR 068 — Une route réservée à un rôle répond 404 à tout le monde, anonyme compris

- Status: accepted
- Date: 2026-09-06
- Scope: story s56-roles-de-session
- Supersède la **raison** écrite au § Decision de l'ADR 058 (« le répartiteur
  répond **403** à une session qui ne porte pas le rôle … la garde de superadmin
  vit donc dans le module, où elle peut répondre 404 »). La **conclusion** de
  l'ADR 058 — les routes du back-office restent `authenticated`, avec leur garde
  dans le module — reste en vigueur, pour une autre raison, écrite ci-dessous.
  Le reste de l'ADR 058 (l'état banni dans le socle) n'est pas touché.

## Context

`ModuleSession.roles` valait `[]`, écrit en dur, depuis huit stories. Le niveau
de protection `role` refusait donc **tout le monde, partout**, et personne ne
l'a vu : le produit refusait trop, jamais trop peu, et une garde trop stricte ne
produit aucun symptôme observable (journal, P38bis). s56 peuple ce tableau —
c'est-à-dire qu'elle rend ce niveau **utilisable pour la première fois**, et
qu'elle doit donc trancher ce que ce niveau fait quand il refuse.

Trois forces se croisent, et aucune n'était tranchée.

**1. Le socle de sécurité impose 404 sur ce qu'on n'a pas le droit de voir.**
`docs/security.md` §3 : « la ressource d'une autre organisation répond **404**,
jamais 403 ». Un 403 est un oracle d'existence — il apprend à qui n'y a pas
droit que la chose existe. Le niveau `role` désigne exactement la surface qu'un
produit ne veut pas annoncer : l'administration, la modération, la console
interne.

**2. Deux stories avaient déjà contourné le niveau, et pour cette raison-là.**
`s37a` puis `s37b2` ont posé les neuf routes du back-office en `authenticated`
avec une garde écrite **dans** le module, qui répond `notFound()`. Le motif est
écrit noir sur blanc dans l'ADR 058 et dans `packages/modules/admin/AGENTS.md` :
« `RouteProtection.level: 'role'` rendrait 403 au répartiteur, ce qui
confirmerait que le back-office existe ». Autrement dit : le seul consommateur
sérieux du niveau `role` l'avait refusé à cause de son statut de refus. Un
niveau de protection déclaré que personne ne peut employer n'est pas un niveau,
c'est un champ.

**3. Le niveau voisin, `entitlement`, répond 403 — et doit continuer.** L'ADR
043 l'a consigné : le catalogue d'offres **vend** la fonctionnalité, son
existence est publique, seul son usage est réservé, et le critère de s21 demande
une invitation à souscrire. Les deux niveaux doivent donc diverger, ce qui rend
la décision explicite obligatoire : sans elle, un lecteur alignerait l'un sur
l'autre par symétrie apparente.

## Decision

**`dispatchModuleRequest` répond 404 à une protection `role` non satisfaite, et
le même 404 à tout le monde** : session sans le rôle, session avec un rôle
voisin, et **appel anonyme**. Corps et en-têtes sont ceux d'un chemin qui ne
correspond à aucune route (`{ error: 'not_found' }`). Une route réservée à un
rôle est indistinguable d'une URL inventée.

**Pourquoi l'anonyme reçoit 404 et non 401** — c'est la moitié surprenante, et
c'est celle qui tient la première. Un 401 dit « cette route existe, connectez-
vous ». Laisser 401 à l'anonyme rendrait donc l'oracle à quiconque se
déconnecte : il suffirait de vider son cookie pour distinguer une route
d'administration d'une URL inventée, et le 404 servi aux connectés ne cacherait
plus rien. Le coût est réel et assumé : un appelant légitime qui a laissé sa
session expirer voit 404 là où 401 lui aurait dit de se reconnecter. C'est
acceptable parce que ce niveau désigne des surfaces qu'on n'atteint pas par
hasard, et parce que l'entrée de navigation qui y mène disparaît par la même
règle (`visibleNavigation`) : personne ne suit un lien vers un 404.

**Le niveau `entitlement` garde son 403**, inchangé (ADR 043).

**Les routes du back-office restent `authenticated`, et la raison change.** La
raison de l'ADR 058 — « `role` rendrait 403 » — est morte avec cette décision.
La raison **survivante**, qui n'était écrite nulle part avant cet ADR, est un
ordre d'évaluation que le contrat ne sait pas exprimer : `asSuperadmin` demande
au port si la session de l'appelant est **empruntée** (impersonation, s37b1,
ADR 064) et refuse **avant** de juger le rôle, fail-closed si la lecture échoue.
Un niveau déclaré ne porte pas cette précondition — le répartiteur juge le rôle
en premier, ou pas du tout —, si bien que basculer ces routes sur `role`
servirait le back-office à une session empruntée dont le compte emprunté
administre. C'est une **élévation de privilège**, pas une régression de forme.
Le jour où le contrat saurait exprimer une précondition de session, la question
se rouvrira ; d'ici là, la ligne correspondante de
`packages/modules/admin/AGENTS.md` porte cette raison, et
`tests/admin.test.ts` (« refuse le back-office à une session empruntée, même
quand le compte emprunté administre ») la fait rougir.

**Un rôle exigé doit être un rôle que le produit sait accorder.** La décision
ci-dessus rend le niveau utilisable ; elle ne suffit pas à le rendre
satisfaisable. Une protection qui nomme un rôle qu'aucun écrivain n'inscrit dans
`admin_platform_role` reproduit exactement le défaut que s56 ferme — et c'est
arrivé dans cette story même, le module de démonstration exigeant `admin`. La
garde est donc exécutable, dans `tests/module-registry.test.ts` : les rôles
exigés sont dérivés de l'annuaire des modules, le vocabulaire accordable est
dérivé de l'unique site d'insertion du module `admin`, et les deux côtés
refusent un balayage vide.

## Considered options

- **Laisser 403 et garder dans chaque module** — c'est le statu quo, et c'est ce
  que `s37a` et `s37b2` ont réellement fait. Rejeté : la garde est alors
  recopiée dans chaque module qui veut cacher sa surface, et chaque copie est
  une occasion de l'oublier — le contraire de la règle « une règle est écrite
  une fois » qui a mis `satisfiesProtection` dans le socle. Surtout, le champ
  `protection: { level: 'role' }` resterait déclaratif et jamais employé : un
  niveau qu'aucun module n'ose déclarer est un champ mort, exactement l'état
  d'où sort cette story.
- **404 pour la session connectée, 401 pour l'anonyme** — rejeté : c'est
  l'option qui paraît la plus prudente et qui ne cache rien. Se déconnecter
  suffit à retrouver l'oracle, donc le 404 servi aux connectés ne protège que
  les gens qui ne pensent pas à essayer.
- **403 partout, et documenter que le niveau ne sert qu'aux surfaces publiques
  et réservées** — rejeté : cela revient à dire que le niveau `role` ne sert
  jamais à cacher, alors que les seules surfaces qui le réclament dans ce dépôt
  (administration, modération) sont précisément celles qu'on cache. Le niveau
  n'aurait aucun appelant.
- **Un cinquième niveau, `hidden-role`, à côté de `role`** — rejeté : deux
  niveaux pour une même question — « cette session porte-t-elle ce rôle ? » — et
  la seule différence serait le statut. Le choix se ferait alors module par
  module, donc mal une fois sur deux, et le contrat gagnerait une variante que
  chaque module écrit déjà devrait considérer.
- **Rendre le statut configurable par route** (`refuseWith: 404 | 403`) —
  rejeté : une décision de sécurité déplacée dans une déclaration se prend au
  moment où on écrit une route, c'est-à-dire au pire moment. Et la valeur par
  défaut redeviendrait la vraie décision, sans ADR.

## Consequences

- **Ce qui devient possible** : un module peut cacher une surface entière par
  une déclaration, sans écrire de garde. Le niveau `role` a enfin un usage
  exécutable — la route et l'entrée de démonstration de `demo-enabled`.
- **Ce qui devient plus dur à diagnostiquer** : un 404 confond désormais trois
  causes — « aucune route ne correspond », « le module n'est pas activé » et
  « la session ne porte pas le rôle ». C'est le prix de l'indistinguabilité, et
  c'est voulu. Les balayages de modularité (`pnpm test:minimal-profile`,
  `pnpm test:socle`) n'en sont pas affaiblis, parce qu'ils dérivent leurs listes
  des modules **coupés** ; en revanche leur contrôle positif ne peut plus
  affirmer que toute route d'un module activé répond autre chose que 404, et le
  commentaire de `e2e/minimal-profile/minimal-profile.spec.ts` le dit.
- **Ce que cet ADR ne touche pas** : l'ADR 030 reste entièrement en vigueur.
  Les routes du module `organizations` restent `authenticated` avec un refus
  **403** décidé dans le module, et pour une raison qui n'a rien à voir avec
  celle-ci — un membre d'une organisation n'apprend rien d'un 403 sur une
  organisation dont l'écran lui montre déjà l'identifiant, et uniformiser sur
  404 rendrait « pas membre » et « membre insuffisant » indiscernables pour le
  développeur. Un rôle d'**organisation** n'est de toute façon pas un rôle de
  plateforme : le ranger dans `ModuleSession.roles` est ce que l'ADR 030 refuse.
- **Ce qui reste ouvert, et qu'aucune commande ne mesure** : un canal temporel.
  Une requête anonyme vers une route à rôle répond après une tentative de
  résolution de session, là où une URL inventée répond avant. Corps et en-têtes
  sont identiques ; seul un chronométrage pourrait distinguer. Aucune mesure
  n'a été faite, et l'écrire ici vaut mieux que de l'affirmer résolu.
- **Ce qui échoue si on casse la décision** : `pnpm test`
  (`tests/module-registry.test.ts` — « répond 404, et non 403, à une session qui
  ne porte pas le rôle » et « répond 404 à l'appel anonyme d'une route réservée
  à un rôle »), et `E2E_PORT=… pnpm test:e2e` (`e2e/admin.spec.ts`), qui exerce
  la chaîne entière avec un vrai cookie et un vrai rôle en base.
