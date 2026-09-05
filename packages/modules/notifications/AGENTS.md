# packages/modules/notifications — règles locales

Le **centre de notifications** (s32) : la liste paginée d'un compte, le badge de
non-lues, le marquage lu, et les **préférences par type et par canal**.

## Ce que ce module n'est pas, et c'est le point

Il est le **magasin** des notifications et des préférences. Il n'émet rien.

La fonction d'émission unique — `createNotificationEmitter` — vit dans
`@repo/emails`, c'est-à-dire dans le socle, et le catalogue de types dans
`config/notifications.ts` (**ADR 057**). La raison est un critère de la story :
« module non activé … les types déclarés retombent sur un envoi email direct » —
c'est-à-dire **ceux dont la déclaration veut un email**. Le repli remplace le
canal in-app disparu ; il ne rallume pas un canal que `config/notifications.ts`
éteint, et les préférences par compte y sont hors de portée puisqu'elles vivent
dans ce module-ci.
Une émission qui vivrait ici disparaîtrait avec le module, et les emails avec —
sans erreur, donc sans signal.

Conséquences à connaître avant d'y toucher :

- **`emails: []` au contrat**, et ce n'est pas un oubli : le registre n'agrège
  que les modules **activés**, donc un texte d'email déclaré ici ne serait plus
  rendable une fois le module coupé. Le texte des emails de notification vit
  dans `config/notifications.ts` ; le **libellé** affiché à l'écran, lui, vit
  dans `src/messages/`, parce qu'il disparaît légitimement avec l'écran ;
- **`publicUrls: () => []`**, et c'est une décision (ADR 054) : un centre de
  notifications est privé — ses cinq routes sont `authenticated` —, et l'indexer
  publierait une surface que personne d'autre ne peut lire ;
- **le catalogue de types est reçu**, jamais lu : `ConfigureNotificationsOptions.types`.
  Le module ne connaît pas `config/notifications.ts` ;
- **le périmètre de lecture est reçu** (`scopeOf`) : ce module ne connaît ni
  `auth`, ni `organizations`, et n'a pas le droit de lire leurs tables. C'est le
  point de composition de l'application qui lui donne l'appartenance, comme
  `readableScopes` pour `storage`.

## Les deux règles qui décident

Elles vivent dans `src/domain/notification.ts`, et ce sont des fonctions pures :

- **`allowedChannels`** — les canaux d'une émission. Trois sources, dans cet
  ordre : les canaux que le **type** déclare (ils bornent tout le reste), la
  **préférence** enregistrée du compte, le **défaut** du type. Une préférence
  survivant à un canal que le type ne déclare plus ne ressuscite pas un envoi ;
- **`isVisibleTo`** — qui voit une notification. Une notification est
  **adressée** : appartenir à l'organisation concernée ne donne pas accès à
  celle d'un collègue, et une notification d'organisation disparaît pour qui n'en
  est plus membre. La route traduit `false` en **404, jamais 403**
  (`docs/security.md` §3), et le repository ne sait pas les distinguer — le
  périmètre est dans le `where`, jamais vérifié après coup.

## Aucun temps réel, et c'est une contrainte de périmètre

Le badge se met à jour **à la navigation** : les routes d'écriture répondent 303
vers l'écran, qui relit le compteur côté serveur. Pas d'intervalle de
rafraîchissement, pas de websocket, pas de sondage, pas de tâche planifiée qui
« pousserait » — le temps réel est au **cimetière du PRD**, et l'y réintroduire
par confort serait une brèche de périmètre, pas une amélioration.

**Le badge est un compteur de l'ensemble**, jamais de la page affichée :
`countUnread` a sa propre requête, et `tests/notifications.test.ts` le mesure sur
vingt-et-une lignes pour une page de vingt.

## Imports autorisés

- `@repo/core` pour le contrat de module, la protection des routes et la
  qualification des clés de traduction ;
- `@repo/ui` pour **tout** ce qui s'affiche — c'est le design system, et la
  seule frontière avec le socle de composants (ADR 022) ;
- `drizzle-orm` dans `infrastructure/` et `schema.ts` uniquement ;
- `zod` pour valider les entrées de route — corps, paramètre de pagination ;
- `lucide-react` pour les icônes de l'écran ;
- `react` (dépendance de pair) pour les composants de `presentation/` ;
- `@repo/typescript-config` pour la configuration du compilateur, `@types/node`
  et `@types/react` pour les types, `typescript` et `vitest` pour l'outillage.

Jamais `@repo/db` (ADR 020) : la connexion est **injectée**. Jamais
`@repo/emails` non plus — la frontière de couches l'interdit au `domain`
(ADR 006), et le reste du module n'en a pas besoin : c'est le socle qui appelle
le module, pas l'inverse.

## Ne doit jamais contenir

- de règle métier hors de `domain/` ;
- d'import d'un autre module : la seule dépendance inter-modules déclarée est
  `requires` (`auth`, ici) ;
- de lecture de `notification` ou de `notification_preference` qui n'applique
  pas le périmètre de l'appelant ;
- de texte affiché en dur : tout vient d'une clé de catalogue, dérivée dans
  `domain/message-keys.ts` — une clé écrite dans un `.tsx` y est vue **non
  qualifiée** par `tests/i18n.test.ts`, donc pour manquante ;
- de `<form>` sans `method` écrit en toutes lettres (`pnpm lint` le refuse) ;
- d'intervalle, de `setInterval`, de websocket ou de sondage.

## Tests

- `src/domain/notification-rules.test.ts` (`pnpm test`) : les règles pures, où la
  matrice des acteurs s'énumère **une fois** ;
- `tests/notifications.test.ts` à la racine : les routes contre une vraie base et
  à travers le répartiteur, le périmètre, les préférences à l'émission, et les
  garanties du module coupé.

**Prouvé par mutation** (5 septembre 2026, sur les mutations posées) : rendre
403 au lieu de 404 sur la notification d'autrui → 2 cas rouges ; retirer le
périmètre du `where` de `markRead` → 1 ; ignorer la préférence dans
`allowedChannels` → 3 ; ignorer les canaux retenus à l'émission → 2.

**Après revue**, trois mutations que la première livraison laissait vertes le
sont devenues (revue s32, F1, F2 et F4) : élargir le catalogue par défaut de
`createAppMailer()` aux templates de notification → 1 ; faire lire `unreadCount`
au shell pour un visiteur anonyme → 1 ; rendre `Pagination` sans condition → 1.
Un garde vert n'est pas un code correct, c'est un filet qui n'existe pas.

**Ce qui est stocké ne nomme personne** (revue s32, ronde 2, R1) : la charge
utile d'une ligne porte des **références** de compte, jamais une adresse ni un
nom. La raison est mécanique : une ligne est adressée à **quelqu'un d'autre**, et
`purge({kind:'user'})` n'efface que ce qui est adressé au compte — une adresse
écrite dans la charge utile survivrait donc à l'effacement de la personne
qu'elle nomme, pendant que le contrat promet `retention: { notification:
'erase' }`. Le type déclare ses clés d'acteur (`actors`, `config/notifications.ts`),
la lecture les résout, et un compte effacé se lit `null` — l'écran y met
« Compte supprimé ».

**Mutations posées, et ce qu'elles couvrent.** Six, chacune à son propre site,
chacune **1 rouge** : écrire l'adresse dans `stored` au producteur ; écrire
`data` au lieu de `stored` dans l'émission ; retirer la résolution à la lecture ;
rendre `account.email` au lieu de `account.name` au point de composition ;
retirer le libellé « compte supprimé » de l'écran ; déplier la lecture groupée en
une requête par identifiant. Les trois dernières ont été ajoutées en ronde 3 —
elles laissaient **2258 cas au vert** pendant que le tableau ci-dessus n'en
nommait que trois, ce qui est exactement la revendication sans commande que la
racine interdit.

**Ce que rien ne mesure encore**, et il faut le lire : la **chaîne complète** de
l'effacement — purger `auth`, donc retirer la ligne de `auth_user`, donc obtenir
un identifiant absent de la résolution, donc afficher le libellé. Le cas
end-to-end de `tests/notifications.test.ts` purge un registre dont la doublure de
contrat `auth` a un `purge` vide : le `null` y vient de l'annuaire de noms de la
suite, pas d'un compte réellement effacé. Chaque maillon est mesuré séparément ;
leur enchaînement est vérifié par lecture.

**Un texte libre reste à la charge de son producteur** : `actors` ne rattrape pas
un `{summary}` qui recopierait une adresse. La règle est « ce qui est stocké ne
porte aucune donnée personnelle », pas « les clés déclarées sont assainies ».

**Le repli du module coupé obéit aux défauts déclarés** : faire ignorer
`defaults.email` au repli → **2 rouges** (la règle dans
`packages/emails/src/notification-emission.test.ts`, le vrai registre amputé
dans `tests/notifications.test.ts`).
