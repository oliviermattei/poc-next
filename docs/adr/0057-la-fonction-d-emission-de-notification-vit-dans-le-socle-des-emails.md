# ADR 057 — La fonction d'émission de notification vit dans `@repo/emails`, pas dans le module

- Status: accepted
- Date: 2026-09-05
- Scope: story s32-notifications-inapp

## Context

Le critère 7 de s32 dit ceci, mot pour mot : « **Module non activé** : aucune
route ni entrée de navigation de notifications, les émetteurs existants ne
provoquent aucune erreur, et **les types déclarés retombent sur un envoi email
direct** ».

La dernière moitié est celle qui décide de l'architecture. Elle exige un point
d'émission **qui survit à la coupure du module** : un appelant écrit
`emit({ type, recipient, … })` et il obtient un email même quand le centre de
notifications n'existe pas. Une émission qui vivrait dans
`packages/modules/notifications` disparaîtrait avec lui — et **les emails
disparaîtraient avec elle, sans erreur, donc sans signal**. C'est le mode
d'échec le plus cher de la story : il ne se voit pas.

La story de cadrage l'avait laissé ouvert délibérément (note du 04/09) : s37 a le
même besoin — la connexion doit refuser un compte banni par un module
optionnel —, et s53 a tranché la forme **contributive** (un module alimente le
plan de site, ADR 054) sans trancher celle-ci. Concevoir un mécanisme de
capacité générique sur deux besoins non implémentés serait la généralisation que
le cimetière du PRD refuse. C'est donc cette story qui tranche, en sachant que
s37 en héritera.

Trois choses doivent se rencontrer à l'émission :

1. le **catalogue de types** — quels canaux ce type emprunte, et par défaut ;
2. le **centre** — les préférences du compte et la ligne in-app, quand le module
   est là ;
3. le **mailer** — le port d'envoi, quand l'email est retenu, et **toujours**
   quand le module n'est pas là.

## Decision

**La fonction d'émission unique vit dans `@repo/emails`, le catalogue de types
dans `config/notifications.ts`, et le module `notifications` n'est que le
magasin.**

Le point de composition de l'application (`apps/web/lib/notifications.ts`)
assemble les trois, et **dérive le centre du registre** :

```ts
notificationCentreOf(registry): NotificationCentre | null
```

`null` quand le registre ne contient pas le module. Le repli du critère 7 est
donc une **absence**, pas une condition disséminée dans le code appelant.

**Ce que le repli remplace, et ce qu'il ne rallume pas.** Il remplace le canal
in-app, qui n'existe plus, pour les types dont la déclaration veut un email :
il ne transforme pas un `email: false` déclaré en envoi. Le catalogue dit
`defaults` par canal, et le repli lit celui de l'email. Le critère 7 — « les
types déclarés retombent sur un envoi email direct » — se lit ainsi, et pas
autrement : couper un module ne doit jamais **ajouter** du trafic sortant que
la configuration complète n'aurait pas émis, ce qui inverserait « un module
désactivé ne laisse aucune trace ». Le cas était réel :
`organization.member-joined` déclare `email: false`, et son producteur émettant
vers chaque membre d'une organisation, le profil « socle » — une configuration
que le propriétaire peut réellement choisir dans `config/profiles.ts` — envoyait
un email à chaque adhésion, que personne n'avait demandé et qu'on ne rappelle
pas.

**Les préférences enregistrées du compte sont hors de portée dans cette
configuration**, et c'est la partie non évidente : elles vivent dans le module
coupé. Le **défaut déclaré** fait donc autorité là, faute de magasin pour tenir
autre chose — ce n'est pas un repli permissif, c'est la seule source qui
subsiste. Ce qui le tient : `packages/emails/src/notification-emission.test.ts`
(« n'envoie rien pour un type dont le défaut du canal email est faux ») et
`tests/notifications.test.ts` (« replie sur l'email les types qui le veulent par
défaut, et eux seuls », contre le vrai registre amputé) — **2 rouges** quand le
repli cesse de lire les défauts.

Le choix du paquet est **dérivé du graphe de dépendances**, pas du goût. La
fonction a besoin du contrat des templates (`@repo/core`) et du port d'envoi
(`@repo/ports`). Un seul paquet importe déjà les deux :

| paquet | importe `@repo/core` | importe `@repo/ports` |
|---|---|---|
| `@repo/core` | — | **non** — zéro dépendance d'exécution |
| `@repo/ports` | non | — |
| **`@repo/emails`** | **oui** | **oui** |

`@repo/emails` porte déjà `transactional-email.ts`, c'est-à-dire le chemin
d'envoi existant, et c'est du **socle** — il n'est jamais coupé.

**Le texte des emails de notification vit dans le socle, pas au contrat de
module**, et c'est la conséquence directe : `buildRegistry` n'agrège les
templates que des modules **activés**, donc un texte déclaré par le module
`notifications` ne serait plus rendable une fois le module coupé — exactement
dans l'état où le repli doit fonctionner. `config/notifications.ts` déclare donc
le texte par locale, et le point de composition compose le catalogue de rendu de
l'émission : les templates des modules activés **plus** ceux des types déclarés.

**Le mailer que les modules reçoivent ne porte pas les seconds**, et c'est la
moitié exécutable du critère 6 : un module qui enverrait `notification.<type>`
directement obtient `invalid_request` du port, à l'exécution, en production
comprise.

**Deux charges utiles, parce qu'il y a deux durées de vie** (revue s32, ronde 2,
R1). `data` est rendu **maintenant** — le texte de l'email, délivré et oublié —
et porte les valeurs affichables. `stored` est **écrit et relu plus tard**, et
porte des **références** : une ligne de notification est adressée à quelqu'un
d'autre et survit aux gens qu'elle nomme, alors que `purge({kind:'user'})`
n'efface que ce qui est **adressé** au compte. Une adresse écrite dans la charge
utile resterait donc lisible après l'effacement, pendant que le contrat du module
promet `retention: 'erase'`.

Le type déclare ses clés d'acteur (`actors`) ; la lecture les résout en noms, et
un compte effacé s'y lit `null`. Les deux champs sont **obligatoires** : un repli
de `stored` sur `data` ferait de l'oubli le comportement par défaut, et l'oubli
est exactement ce qui a écrit une adresse dans la ligne des autres. L'exit
rejeté est d'**étendre la purge** pour chercher dans les charges utiles : chaque
forme de charge future devrait alors se souvenir d'être fouillable, ce qu'aucune
commande ne vérifie — alors qu'une charge sans donnée personnelle n'a besoin
d'aucune logique de purge.

## Considered options

- **Dans le module `notifications`** — rejeté : il contredit le critère 7. Un
  module coupé ferait disparaître l'émission, et les emails avec, sans erreur
  chez l'appelant. C'est précisément le défaut que la story demande d'éviter.
- **Dans `@repo/core`** — rejeté : `@repo/core` n'a **aucune** dépendance
  d'exécution (vérifié : son `package.json` ne déclare que de l'outillage de
  développement). Lui donner une dépendance vers `@repo/ports` pour cette story
  inverserait la couche la plus stable du dépôt — celle que tous les modules et
  les deux points de composition importent.
- **Un cinquième port** (`Notifier`) — rejeté : un port est l'interface d'une
  dépendance **externe**, avec une implémentation par fournisseur
  (`AGENTS.md`, « une implémentation par port »). Le repli sur l'email direct
  n'est pas un fournisseur, et le dépôt n'a aucun second adaptateur à lui
  opposer. Ce serait un port à une implémentation, donc une indirection sans
  frontière.
- **Une seizième clé au contrat de module** (`notificationTypes`) — rejeté : le
  contrat en compte quinze depuis s53, et chacune est obligatoire dès le premier
  module. En ajouter une rouvrirait les **treize** modules du dépôt pour une
  clé que douze d'entre eux rendraient vide — et surtout, elle ne réglerait pas
  le problème : une clé de contrat n'est lue que pour les modules **activés**,
  donc le catalogue disparaîtrait toujours avec le module qui le porte.
- **Un mécanisme de capacité générique** (un module optionnel « offre » une
  capacité que le socle consulte, avec une absence définie) — rejeté **pour
  maintenant** : c'est ce dont s37 aura besoin, et le concevoir sur deux besoins
  dont un seul est implémenté produirait une abstraction non exercée. La forme
  retenue ici — une **fonction du socle** qui reçoit un collaborateur optionnel
  dérivé du registre — est celle dont s37 pourra hériter, ou qu'elle
  généralisera avec deux cas réels sous les yeux.

## Consequences

**Ce qui devient facile.** Un émetteur écrit une ligne et n'a aucune condition à
porter : `emitNotification({ type, recipient, organizationId, data })` rend un
résultat discriminé dans les deux configurations. s37 et s43, qui dépendent de
cette story, héritent d'un point d'appel unique et d'un catalogue déclaratif.

**Ce qui devient plus difficile.** Le texte d'un email de notification ne vit
pas au même endroit que celui d'un email transactionnel : le premier dans
`config/notifications.ts` (socle), le second dans le contrat de son module. La
règle qui les départage est simple — *le module qui déclare le texte doit être
activé au moment de l'envoi* — mais elle se lit, elle ne se devine pas. Elle est
écrite dans `packages/modules/notifications/AGENTS.md` et dans
`config/notifications.ts`.

**Ce qu'il faut surveiller.**

1. **Le libellé affiché d'un type vit dans le module, son texte d'email dans le
   socle.** C'est cohérent — l'un disparaît avec l'écran, l'autre non — mais un
   type ajouté sans son libellé ferait un écran en 500. La règle est
   **exécutable** : `tests/notifications.test.ts` confronte les types déclarés
   aux catalogues de chaque locale, et rougit.
2. **Le balayage du critère 6 est syntaxique, et il dit ce qu'il balaie.** Il
   lit l'expression écrite dans `template:` de chaque appel à `mailer.send` des
   fichiers de production ; il ne voit pas un identifiant reconstruit à
   l'exécution. C'est pourquoi le filet **exécutable** existe à côté : le
   catalogue de rendu des modules ne contient pas les templates de notification.
3. **s37 doit relire cet ADR avant d'inventer une seconde forme.** Si son besoin
   se plie à « une fonction du socle qui reçoit un collaborateur optionnel
   dérivé du registre », il n'y a rien à généraliser. Sinon, c'est le moment de
   le faire — avec deux cas réels, et un ADR qui supersède celui-ci.
