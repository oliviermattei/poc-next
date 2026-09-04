# Research — Story s32-notifications-inapp

> Recherche menée **en lecture seule sur `dev`** (commit `66b90e3`), sans worktree dédié et sans base — une recherche ne se connecte à rien. Le document est déposé sur la branche de la story pour voyager avec elle.

## Les cinq faits structurants

1. **Tous les emails que le dépôt sait envoyer sont exclus du critère 6 par la story elle-même.** Balayage de `mailer.send` sur `packages/` et `apps/` : **trois** fichiers de production l'appellent — `auth/src/application/auth-use-cases.ts` (4 sites), `marketing/src/application/public-forms.ts` (2), `organizations/src/application/organization-use-cases.ts` (1) — plus le port et l'adaptateur. Les templates déclarés se comptent à **six** : auth 3, marketing 2, organizations 1. La note de la story range vérification, magic link, réinitialisation, invitation de s16, lien de mot de passe de s24, confirmation de s34 et lien d'export de s35 dans les « appels directs légitimes ». **Il ne reste rien.**
2. **Donc le critère 6 risque d'être vide à la livraison.** « Tout email correspondant à un type déclaré dans le registre de préférences passe par la fonction d'émission unique ; un test vérifie qu'aucun de ces types n'appelle le mailer directement » — si le registre ne contient que des types que s32 crée, le test balaie ce que la story vient d'écrire. C'est le mode d'échec que `AGENTS.md` nomme déjà pour `pnpm test:minimal-profile` : « un **balayage vide** … rendrait les vérifications vertes sans rien vérifier ». Le plan doit poser un plancher assertionné, comme s26 l'a fait.
3. **Le critère 7 impose un point d'émission qui survit à la coupure du module.** « Module non activé : … les types déclarés retombent sur un envoi email direct. » La fonction d'émission unique ne peut donc pas vivre *dans* `packages/modules/notifications` : elle doit être atteignable quand ce module n'est pas chargé. C'est la même classe de question que le plan de site pour s29 — une préoccupation transverse que le contrat de module ne prévoit pas — et elle mérite un ADR.
4. **Le temps réel est au cimetière du PRD.** Lecture au chargement et à la navigation uniquement. « Le badge se met à jour après lecture » est donc satisfaisable sans websocket ni sondage : c'est une contrainte qui **simplifie**, à condition de ne pas introduire un intervalle de rafraîchissement par confort.
5. **Le périmètre par organisation est déjà outillé.** s17 a posé les rôles et le scoping ; le critère « une notification d'organisation n'est visible que par les membres concernés » retombe sur `docs/security.md` §3 — **404, jamais 403**, sur la ressource d'autrui.

## Target story

Centre de notifications paginé (plus récentes en premier) · badge de non-lues · marquage lu, unitaire et global · préférences par type **et par canal** (in-app, email), respectées à l'émission · périmètre organisation · émission unique pour les types du registre · module coupé : aucune route, aucune entrée de navigation, aucune erreur chez les émetteurs existants, et repli sur l'email direct.

Dépendances déclarées : `s17-roles-permissions`, `s06-transactional-emails` — **les deux sont fusionnées**.

## État actuel du code

Aucun module `notifications` n'existe. Le contrat de module (`packages/core/src/module.ts`) porte quatorze clés — `id, requires, schema, migrations, routes, navigation, messages, emails, webhooks, jobs, dataCategories, retention, purge, export` — dont `emails` (avec leurs locales) et `navigation` couvrent une partie du besoin. Rien n'y concerne une préférence utilisateur ni un canal.

Le port mailer (`packages/ports/src/mailer.ts`) rend un résultat discriminé, jamais une exception (règle du dépôt) : la fonction d'émission héritera de cette forme.

## Points d'ancrage

- `packages/ports/src/mailer.ts` — la forme du résultat, et le seul chemin d'envoi.
- `packages/modules/*/src/application/*-use-cases.ts` — les sept sites d'appel actuels, tous exclus du critère 6.
- `packages/core/src/registry.ts` — l'agrégation des entrées de navigation, qui tient déjà la moitié « le lien disparaît » du critère 7.
- `docs/security.md` §3 — 404 plutôt que 403 sur la ressource d'autrui.

## Pièges & contraintes

- **Ne pas refactorer les sept appels existants.** La note de la story l'interdit nommément ; les toucher élargirait le diff sans servir un critère.
- **Le repli du critère 7 est la partie qui casse en silence.** Un module coupé qui ferait disparaître l'émission ferait disparaître les emails avec — sans erreur, donc sans signal. C'est un cas à éprouver par mutation, pas à supposer.
- **Le temps réel est au cimetière** : pas de websocket, pas de sondage périodique introduit « pour le confort ».
- **Le badge est un compteur** : attention à ne pas le dériver d'une page de liste paginée, sinon il compte la page et non l'ensemble.
- **s37 (admin) et s43 (widget de retour) dépendent de cette story.** Ce qu'on décide du registre de types et du point d'émission les engage toutes les deux.

## Questions ouvertes

- **Où vit la fonction d'émission unique**, puisqu'elle doit survivre à la coupure du module ? `packages/core` ? Un service au niveau de l'application ? Une quinzième clé au contrat ? Les trois ont des coûts différents et la troisième rouvre onze modules.
- **Comment éviter que le critère 6 soit vide ?** Deux voies : déclarer au moins un type de notification qui correspond à un email **existant** (mais la note les exclut tous), ou poser un plancher assertionné sur la taille du registre et sur le nombre de sites balayés. À trancher au plan.
- **Les préférences sont-elles par utilisateur, ou par utilisateur et organisation ?** Le critère parle de « ses » préférences ; le critère de périmètre parle d'organisation. Non tranché par la story.
- **Un type sans template d'email peut-il être activé sur le canal email ?** La configuration doit refuser ou dégrader — non spécifié.

## Complexité réelle

La story est notée **3**. **Ma note : 4** — non pour la difficulté du centre de notifications, qui est un CRUD paginé, mais parce que deux critères sur sept (6 et 7) portent une décision d'architecture transverse dont dépendent s37 et s43, et que le critère 6 est vulnérable au balayage vide. La partie visible est simple ; la partie qui engage le reste ne l'est pas.

Pas de proposition de découpe : les sept critères partagent le registre de types, et le séparer produirait une story qui ne close rien.
