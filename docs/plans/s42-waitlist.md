---
story: s42-waitlist
validated: yes
---

# Plan — s42-waitlist

> Planifié contre `dev` au commit `57e1763`. La recherche de cette story est sur `dev`, datée d'un commit plus tôt.

## Cette story avait été anticipée, et le code la nomme

Le commentaire de la table `public_subscription` écrit : *« cette table est réutilisée par s42 pour la liste d'attente, et **un second modèle concurrent est interdit** »*. Celui de la colonne `source` : *« `newsletter` aujourd'hui, `waitlist` en s42. La colonne qui les sépare. »*

Cette story n'invente donc pas un modèle : elle en emprunte un qui l'attendait, et **quatre garanties viennent avec** — la catégorie de données, la rétention, la purge et l'export sont déjà déclarées. Un modèle neuf les rouvrirait toutes.

## La décision : une source de plus dans `marketing`, pas un module neuf

La recherche laisse la question ouverte. **Un module `waitlist` qui requiert `marketing` pour lui emprunter sa table serait une dépendance déclarée pour trois fichiers, et un second endroit d'où l'on écrit dans une table qu'un autre module possède** — ce que l'ADR 018 et la borne d'import d'`admin` refusent par ailleurs. La liste d'attente est une **seconde source du même formulaire public**, et c'est ainsi que `s11` l'a prévue.

Conséquence assumée : le critère 6 (« module non activé ») se lit sur `marketing`, comme pour la newsletter et le formulaire de contact.

## Tâches

- [x] **1. La source, en configuration.** `config/marketing.ts` déclare déjà `newsletterSource` ; la liste d'attente en obtient une, validée par le même schéma. **Le module n'écrit jamais le littéral** — c'est la règle que la newsletter respecte déjà.
- [x] **2. La route, avec sa politique de débit déclarée.** `routeIsRateLimited` rend `true` pour toute route publique, mais celle qui ne déclare rien hérite de `default` : **120 requêtes par minute**, là où `publicForm` en autorise 60 par dix minutes. Les deux formulaires existants la déclarent explicitement. Mutation : retirer la déclaration doit rougir en nommant la politique obtenue.
- [x] **3. Le doublon, par l'index et non par une lecture.** L'unicité porte sur la paire `(source, email)` : une seconde inscription confirme sans créer de ligne. Mesuré en comptant, pas en lisant le code.
- [x] **4. La page**, composée de `PublicForm` — `action`, `locale`, `fields`, `messageKeys`. Aucun composant neuf : le formulaire public est générique et vit dans l'application parce que le lint refuse un `fetch` sortant depuis un module.
- [x] **5. Les clés de message, et celle qu'il ne faut pas écrire.** La newsletter se prive **délibérément** d'un message « adresse invalide », parce que le serveur répond identiquement à une adresse nouvelle, déjà inscrite ou malformée (`docs/security.md` §7). **Copier cette omission** : livrer la clé préparerait l'affichage d'un cas que le serveur ne produit jamais.
- [x] **6. Le courriel de confirmation**, déclaré dans le contrat du module avec ses locales, comme celui de la newsletter.
- [x] **7. Module coupé** : aucune route, aucune page, et **la page d'accueil inchangée** — le critère 6 l'exige nommément. Dérivé du registre.

## Ce que la story ne fait pas

Elle ne remplace pas la page d'accueil par la liste d'attente — **retiré explicitement du périmètre** par la story elle-même. Elle ne crée pas de table, pas de module, pas de composant. Elle ne livre pas d'écran de back-office : c'est `s37c`, en cours au moment d'écrire ceci — le critère 4 se lit donc sur la **source portée par les lignes**, et le plan le dit plutôt que de supposer l'écran présent.

## Sections de `docs/security.md` touchées

**Limitation de débit sur un point d'entrée public** — déclarée, jamais héritée par défaut. **Anti-automatisation** : le champ leurre est déjà là, et une soumission piégée reçoit **la même réponse** qu'une vraie. **Message identique** pour une adresse nouvelle, déjà inscrite ou malformée. **`method="post"` en littéral**, porté par le composant partagé.
