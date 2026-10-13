# ADR 057 — La fonction d'émission de notification vit dans `@repo/emails`, pas dans le module

- Status: accepted
- Date: 2026-09-05

Module `notifications` coupé, les types de notification déclarés doivent retomber sur un envoi email direct. Une émission qui vivrait dans le module disparaîtrait avec lui, et les emails avec elle, sans erreur chez l'appelant — le mode d'échec le plus cher, parce qu'il ne se voit pas. **La fabrique d'émission (`createNotificationEmitter`) vit dans `@repo/emails`, le catalogue de types dans `config/notifications.ts`, et le module `notifications` n'est que le magasin** (préférences, lignes in-app). Le point de composition `apps/web/lib/notifications.ts` assemble les trois, expose `emitNotification`, et dérive le centre du registre : `notificationCentreOf(registry)` rend `null` quand le module est absent. Le repli est une absence, pas une condition dans le code appelant.

Le paquet découle du graphe de dépendances : la fonction a besoin du contrat des templates (`@repo/core`) et du port d'envoi (`@repo/ports`), et `@repo/emails`, du socle, est le seul à importer déjà les deux. C'est la forme retenue pour un chemin du socle qui consulte un module optionnel : une fonction du socle qui reçoit un collaborateur optionnel dérivé du registre.

Module coupé, le **défaut déclaré** du canal email fait autorité, faute de magasin pour les préférences : le repli remplace le canal in-app, il ne transforme jamais un `email: false` en envoi. Couper un module ne doit pas ajouter de trafic sortant que la configuration complète n'aurait pas émis. Le texte des emails de notification vit dans `config/notifications.ts`, pas au contrat du module, parce que `buildRegistry` n'agrège que les templates des modules activés. Le mailer que reçoivent les modules ne porte pas ces templates : un module qui enverrait `notification.<type>` directement obtient `invalid_request` du port.

Une émission porte deux charges : `data`, rendue maintenant dans l'email, et `stored`, écrite et relue plus tard, qui ne contient que des **références** (`actors`, résolus en noms à la lecture, `null` pour un compte effacé). Une ligne de notification est adressée à quelqu'un d'autre et survit aux personnes qu'elle nomme ; une adresse dans la charge resterait lisible après l'effacement. Les deux champs sont obligatoires, pour que l'oubli ne soit pas le défaut.

## Considered options

- **Dans `@repo/core`** — rejeté : le cœur n'a aucune dépendance d'exécution, et lui donner `@repo/ports` inverserait la couche la plus stable du dépôt.
- **Un port `Notifier`** — rejeté : un port est l'interface d'une dépendance externe ; le repli sur l'email n'est pas un fournisseur.
- **Une clé `notificationTypes` au contrat de module** — rejeté : une clé de contrat n'est lue que pour les modules activés, donc le catalogue disparaîtrait avec le module qui le porte.
- **Étendre la purge pour fouiller les charges utiles** — rejeté : chaque forme future de charge devrait se souvenir d'être fouillable, ce qu'aucune commande ne vérifie.

## Consequences

- Le libellé affiché d'un type vit dans le module, son texte d'email dans le socle ; `tests/notifications.test.ts` confronte les types déclarés aux catalogues de chaque locale.
- La garde contre un envoi direct de `notification.<type>` est syntaxique (l'expression de `template:`) ; le filet exécutable est l'absence de ces templates dans le catalogue des modules.
