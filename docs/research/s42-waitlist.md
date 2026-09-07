# Research — Story s42-waitlist

> Vérifiée contre la branche par défaut au commit `cf0d2fc`, en lecture seule, complétée par une inspection du module `marketing` et du socle des formulaires publics.

## Les six faits structurants

1. **La story a été anticipée par `s11`, et le code la nomme.** Le commentaire de la table `public_subscription` (`packages/modules/marketing/src/schema.ts:41`) écrit : *« cette table est réutilisée par s42 pour la liste d'attente, et un second modèle concurrent est interdit »*, et celui de la colonne `source` : *« `newsletter` aujourd'hui, `waitlist` en s42. La colonne qui les sépare. »* La même phrase est répétée dans `config/marketing.ts`. **Cette story ne conçoit pas un modèle, elle en emprunte un qui l'attendait.**

2. **L'unicité est portée par un index, pas par une lecture.** `public_subscription_source_email_key` est unique sur **la paire** `(source, email)`. Le critère 2 — un email déjà inscrit confirme sans doublon — est donc une propriété du schéma, pas une branche à écrire. L'adresse est normalisée avant écriture.

3. **Le composant de formulaire public existe, générique, hors des modules.** `apps/web/app/public-form.tsx` prend `action`, `locale`, `fields`, `messageKeys`. Il vit dans l'application et non dans le module parce que le lint **refuse un `fetch` sortant depuis un module**. Il écrit déjà `method="post"` en littéral et désactive son bouton jusqu'à l'hydratation. **Une liste d'attente est un jeu de clés et une action, pas un composant.**

4. **L'anti-automatisation est livrée, et son piège est judicieux.** Le champ leurre est nommé une seule fois et exporté, de sorte que le rendu et le juge nomment le même littéral ; une soumission piégée reçoit **le même `200`** qu'une vraie, donc la réponse n'apprend à personne quel champ corriger. Le `<noscript>` est là. Le captcha est déclaré, désactivé, et son activation sans origine déclarée **fait refuser le démarrage**.

5. **Le critère 5 est un piège de configuration, pas de code.** `routeIsRateLimited` rend `true` pour **toute** route publique, déclarée ou non — mais une route qui n'annonce rien hérite de la politique `default` : 120 requêtes par minute, là où `publicForm` en autorise 60 par **dix** minutes. Les deux formulaires existants déclarent `rateLimit: { policy: 'publicForm' }` **explicitement**. Une liste d'attente qui l'omet serait limitée, et mal.

6. **Quatre garanties viennent gratuitement avec la table empruntée** : la catégorie de données `subscription`, sa politique de rétention, sa purge et son export sont déjà déclarées par le module. Un nouveau modèle les rouvrirait toutes — c'est le meilleur argument pour l'emprunt, meilleur que l'économie de code.

## Points d'ancrage

- `packages/modules/marketing/src/schema.ts:41` — la table, son index unique, et le commentaire qui nomme cette story.
- `packages/modules/marketing/src/presentation/public-form-routes.ts:129` — la route de la newsletter, sa politique de débit déclarée, ses quatre réponses.
- `packages/modules/marketing/src/domain/message-keys.ts:141` — les clés de la newsletter, **et l'absence délibérée d'une clé « adresse invalide »**.
- `apps/web/app/public-form.tsx` — le composant, et la raison écrite de sa place.
- `config/marketing.ts:102` — `newsletterSource`, la source comme **configuration** et non comme littéral du module.

## Pièges & contraintes

- **Ne pas livrer de message « adresse invalide ».** Le serveur répond identiquement à une adresse nouvelle, déjà inscrite ou malformée (`docs/security.md` §7). Une clé de message pour un cas que le serveur ne produit jamais **prépare son affichage** — la newsletter s'en est délibérément privée, la liste d'attente doit copier cette omission.
- **La source est une configuration**, pas une chaîne écrite dans le module. Le module ne doit jamais écrire `'waitlist'`.
- **Le remplacement de la page d'accueil est hors périmètre**, retiré explicitement par la story. Une page, pas une bascule du site.
- **Le critère 4 dépend d'une vue de back-office** qui, elle, appartient à `s37c` — story en cours au moment d'écrire ceci. Si elle n'a pas atterri, ce critère se lit sur la **source portée par les lignes**, pas sur un écran.
- **Le module doit rester coupable sans trace** : ni route, ni page, ni entrée — et la page d'accueil inchangée, ce que le critère 6 exige nommément.

## Questions ouvertes

- **Un module neuf, ou une extension du module marketing ?** Le modèle est emprunté ; l'écran, la route et le courriel restent à loger. Un module `waitlist` qui requiert `marketing` déclare sa dépendance honnêtement ; une source de plus dans `marketing` évite un module pour trois fichiers. **Non tranché ici.**
- **Le courriel de confirmation** : le module marketing en déclare déjà un pour la newsletter. Le réemployer avec un autre libellé, ou en déclarer un second ?

## Complexité réelle

Notée **2** dans `docs/stories.md`. **Ma note : 2.** Le modèle, l'unicité, le composant, l'anti-automatisation, la limitation et les quatre garanties RGPD existent. Ce qui reste : une source, une route qui déclare sa politique, une page, un courriel, et la discipline de ne pas ajouter le message que la sécurité interdit.
