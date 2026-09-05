---
story: s32-notifications-inapp
validated: yes
---

# Plan — s32-notifications-inapp

> Planifié contre `dev` au commit `ac3ebf4`, sur la recherche **re-vérifiée le 05/09** (45 commits après sa date). La re-vérification a trouvé une dérive bloquante : le contrat de module porte désormais **quinze** clés, `publicUrls` comprise (s53, ADR 054). La recherche en annonce quatorze.

## Les deux décisions structurelles

### 1. Où vit la fonction d'émission unique — `@repo/emails`

Le critère 7 exige qu'elle survive à la coupure du module : « module non activé … les types déclarés retombent sur un envoi email direct ». Elle ne peut donc pas vivre dans `packages/modules/notifications`.

**Dérivé du graphe de dépendances, pas choisi par goût.** La fonction a besoin de deux choses : le registre (savoir si le module répond) et le mailer (replier sinon). Un seul paquet importe déjà les deux :

| paquet | `@repo/core` | `@repo/ports` |
|---|---|---|
| `@repo/core` | — | **non** (zéro dépendance) |
| `@repo/ports` | non | — |
| **`@repo/emails`** | **oui** | **oui** |

`@repo/core` est le contrat pur : lui donner une dépendance vers `ports` pour cette story inverserait la couche la plus stable du dépôt. `@repo/emails` porte déjà `transactional-email.ts`, c'est-à-dire le chemin d'envoi existant, et c'est du **socle** — jamais coupé. ADR à écrire.

### 2. Le critère 6 est vide à la livraison si on ne le contraint pas

La recherche l'établit : les six templates existants (auth 3, marketing 2, organizations 1) sont **tous** rangés par la story dans les « appels directs légitimes ». Le test du critère 6 balaierait donc exactement les types que s32 vient d'écrire — vert sans rien vérifier, le mode d'échec qu'`AGENTS.md` nomme pour `test:minimal-profile`.

**Contrainte retenue** : le test pose un plancher assertionné et **dérive** la liste des exclus au lieu de la recopier. Il échoue si le registre de types est vide, si aucun type n'est effectivement balayé, ou si un type déclaré appelle `mailer.send` sans passer par l'émission.

## Tâches

- [x] **1. Le registre de types de notification, et son plancher.** Un type déclare son id, ses canaux possibles (`in_app`, `email`) et son défaut par canal. Test d'abord : un registre vide **refuse**, et le balayage du critère 6 refuse de se déclarer vert sur zéro type. C'est la tâche qui empêche la story d'être une coquille.
- [x] **2. `emitNotification` dans `@repo/emails`.** Signature en résultat discriminé (`{ok:true} | {ok:false,error}`), jamais d'exception — la forme du dépôt, héritée du port mailer. Deux chemins : module actif → persiste l'in-app et envoie l'email selon les préférences ; **module coupé → envoi email direct**, sans erreur chez l'appelant. Tests des deux chemins, le second en coupant réellement le module dans la configuration de test.
- [x] **3. Le module `notifications`, échafaudé par `npx ks`.** Jamais à la main (règle du dépôt). **Quinze clés**, `publicUrls` comprise — un centre de notifications est privé, elle vaut donc liste vide, et c'est une décision, pas un oubli. Schéma : notification (id, organisation, destinataire, type, charge, lu_le) et préférence (utilisateur, type, canal, actif).
- [x] **4. Persistance et périmètre, testés à la frontière.** Repository Drizzle, requêtes paramétrées. **Une notification d'une autre organisation renvoie 404, jamais 403** (`docs/security.md` §3) — test explicite, et mutation : renvoyer 403 doit rougir.
- [x] **5. Routes et contrats oRPC.** Liste paginée (plus récentes en premier), marquage unitaire, marquage global, lecture et écriture des préférences. Chaque route déclare son **niveau de protection** dans le contrat (`authenticated`). Zod à la frontière : params, corps, pagination.
- [x] **6. Écran du centre de notifications + badge.** Composé exclusivement des composants du design system. Le badge se met à jour **après lecture**, à la navigation — **aucun intervalle de rafraîchissement, aucun websocket** : le temps réel est au cimetière du PRD, et l'y réintroduire par confort serait une brèche de périmètre.
- [x] **7. Préférences respectées à l'émission, par type *et* par canal.** Test : un type dont le canal email est désactivé n'envoie pas d'email mais crée l'in-app, et réciproquement. Mutation : ignorer la préférence doit rougir.
- [x] **8. Module coupé — les quatre garanties.** Aucune route (404), aucune entrée de navigation, aucune table sur une base neuve, **et aucune erreur chez les émetteurs existants**. Les trois premières sont déjà outillées par `pnpm test:minimal-profile`, qui dérive tout du contrat ; la quatrième est propre à cette story et se teste à l'appel.
- [x] **9. ADR — la fonction d'émission vit dans `@repo/emails`.** Avec les options rejetées : `@repo/core` (inverserait la couche la plus stable), un cinquième port (le repli n'est pas un fournisseur, et le dépôt n'a pas de second adaptateur à lui opposer), le module lui-même (contredit le critère 7).

## Après revue — ce que la passe de correction a ajouté

Les neuf tâches ci-dessus étaient livrées quand la revue est passée
(`Max severity: major`, `Ship allowed: yes`). Ce qui suit vient d'elle, pas du
plan initial :

- [x] **F1 — le second filet du critère 6 mord au point de composition.** Le cas
  n'assemble plus son propre catalogue de rendu : il envoie par
  `createAppMailer()`, le mailer que les modules reçoivent, et vérifie le refus
  `invalid_request` ; un envoi de contrôle par le catalogue élargi de l'émission
  interdit la vacuité.
- [x] **F2 — le garde du badge du shell est mesuré là où il agit.** Nouveau cas
  dans `tests/marketing.test.ts`, qui **monte le module de force** et vérifie
  qu'il l'est avant de compter les connexions ouvertes.
- [x] **F3 — pluriel ICU sur `screen.unread`**, dans les deux locales, avec
  l'idiome déjà employé par `apps/web/messages/fr.json`.
- [x] **F4 — le cas de pagination mesure le garde de l'écran**, par le nom
  accessible de la barre, et non l'absence d'une seconde page.
- [x] **Le garde de câblage sort de `describe.skipIf`** : il ne dépend d'une base
  que pour son propre nettoyage.
- [x] **Le repli du module coupé obéit aux défauts déclarés.** Sans cela, choisir
  le profil « socle » envoyait un email à chaque membre à chaque adhésion,
  alors que le type déclare `email: false` : couper un module ajoutait du
  trafic sortant que la configuration complète n'aurait pas émis. ADR 057
  corrigé en place — il n'est pas fusionné.
- [x] **Ce qui est stocké ne nomme personne** (ronde 2, R1). La charge utile
  écrite porte l'identifiant du compte arrivé, pas son adresse ; le type déclare
  ses clés d'acteur et la lecture les résout, un compte effacé s'y lisant
  « Compte supprimé ». L'exit retenu est celui du relecteur : stocker la
  référence, résoudre à l'affichage — pas étendre la purge, qui obligerait
  chaque charge future à se souvenir d'être fouillable.
- [x] **Le câblage de la résolution mord** (ronde 3, R3-1 à R3-3). Trois
  mutations laissaient 2258 cas au vert : rendre l'adresse au lieu du nom au
  point de composition, retirer le libellé « compte supprimé » de l'écran, et
  vider la liste du périmètre. Les trois rougissent désormais, et la lecture
  groupée (`viewAccounts` → `findByIds`, un `inArray`) rend vraie la phrase du
  module sur le nombre d'appels, au lieu de la corriger.
- [x] **Le périmètre de lecture est celui de l'organisation active** (ronde 2,
  R2) : le commentaire promettait toutes les appartenances, le code n'en a
  jamais rendu qu'une. C'est le **commentaire** qui était faux ; la décision et
  ce qu'elle retarde sont écrits dans `apps/web/lib/notifications.ts`.
- [x] **Le critère 7 de `docs/stories.md` porte sa restriction** (ronde 2, R5).
- [x] **F5 — un producteur réel pour `organization.member-joined`**, autorisé par
  le propriétaire. `organizations` reçoit l'émission au point de composition et
  prévient les membres déjà présents, une fois chacun, le nouveau venu exclu.
  `account.security-alert` reste **sans producteur**.

## Ce que la story ne fait pas

Le temps réel, un intervalle de rafraîchissement, une table d'audit, une notification par SMS ou push. Les six templates email existants **ne sont pas migrés** vers l'émission unique : la story les range explicitement dans les appels directs légitimes.

## Sections de `docs/security.md` touchées

§3 (404 plutôt que 403 sur la ressource d'autrui) · Zod à chaque frontière · permissions vérifiées côté serveur · routes déclarant leur niveau de protection.
