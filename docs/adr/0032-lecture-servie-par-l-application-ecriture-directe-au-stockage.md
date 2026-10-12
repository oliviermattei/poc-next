# ADR 032 — L'écriture va directement au stockage, la lecture passe par l'application

- Status: accepted
- Date: 2026-09-01
- Scope: story s18-file-storage-avatar

## Context

Le critère 2 de s18 est explicite : « le téléversement se fait directement vers
le stockage via URL présignée, **sans transiter par le serveur applicatif** ».
Le critère 5 l'est tout autant : « un fichier rattaché à une organisation n'est
lisible **que par ses membres** ».

La lecture symétrique de l'écriture — une seconde URL présignée, de lecture
cette fois — est la forme que toutes les cibles du PRD emploient. Elle se heurte
ici à deux choses **mesurées**, pas supposées.

**1. La politique de sécurité du contenu livrée par s45.**
`apps/web/lib/security-headers.ts` émet `img-src 'self' <sources>` et
`connect-src 'self' <sources>`, et `config/security.ts` — le seul endroit d'où
une source peut entrer — livre les sept listes **vides**. Une image servie par
`https://<compte>.r2.cloudflarestorage.com` est donc refusée par le navigateur,
et l'`Avatar` retombe silencieusement sur les initiales : le remplacement a
« marché », l'image n'apparaît pas, et rien dans les journaux du serveur ne le
dit.

**2. Une URL présignée de lecture est une capacité détachée de
l'appartenance.** Émise pour un membre, elle reste valide pendant toute sa durée
de vie — y compris après que ce membre a quitté l'organisation, et elle est
transmissible telle quelle. C'est exactement ce que l'ADR 025 a refusé pour
l'organisation active : « le pouvoir suit la ligne, pas le jeton ». Une durée
courte réduit la fenêtre, elle ne change pas la nature.

## Decision

**L'asymétrie est assumée et elle est la décision :**

- **l'écriture** va directement au stockage. Le serveur juge le type et la
  taille annoncés, fabrique la clé, émet l'URL présignée — puis les octets vont
  du navigateur au fournisseur sans traverser l'application ;
- **la lecture** passe par une route du module, `GET /api/modules/storage/file`,
  qui relit l'appartenance à chaque requête et sert les octets elle-même. Le
  port `Storage` n'expose donc **aucune** présignature de lecture.

Trois conséquences directes :

1. **la vérification du contenu réel a lieu à la confirmation**, après le
   téléversement, en relisant l'objet par le port. C'est le seul moment
   possible : aucune signature ne lie un en-tête `Content-Type` à des octets, et
   les octets ne passent pas par nous ;
2. **le mode local présigne vers notre propre origine**
   (`/api/modules/storage/local-upload`, signé par HMAC, avec échéance). L'état
   livré du dépôt téléverse donc sans qu'aucune source n'entre dans
   `config/security.ts` ;
3. **avec un vrai seau, son origine doit entrer dans `config/security.ts`,
   champ `connect`** — et seulement `connect` : la lecture n'a besoin de rien,
   puisqu'elle est servie par nous. C'est un geste du propriétaire du projet,
   dans le fichier prévu pour cela, documenté dans `.env.example`. **Cette
   story ne touche pas `config/security.ts`** : elle appartient au périmètre de
   s45, et l'y modifier serait exactement l'élargissement « pour faire marcher »
   que `docs/security.md` §1 refuse.

## Options considérées

### A. URL présignée de lecture, et le domaine du seau dans `img-src` — rejetée

C'est la forme la plus courante, et elle a deux coûts que le dépôt refuse. Le
premier : elle oblige à ouvrir `img-src` à un domaine tiers, donc à modifier
`config/security.ts` depuis une story qui n'en est pas propriétaire, pour un
gain que l'option retenue obtient sans rien ouvrir. Le second : elle rend le
critère 5 invérifiable après l'émission — l'appartenance n'est plus relue.

Ce qu'elle aurait apporté : le trafic d'images ne passe plus par
l'application. Sur un avatar de 2 Mo au maximum, servi derrière une session,
c'est un gain d'exploitation, pas un gain de produit — et il se récupère par un
cache HTTP si un jour il compte.

### B. Tout par l'application, téléversement compris — rejetée

Elle simplifierait tout : un seul chemin, aucune URL présignée, aucune source à
déclarer dans la politique. Elle est refusée parce que le critère 2 dit le
contraire, et pour la raison qui l'a fait écrire : un téléversement qui traverse
l'application consomme sa mémoire et son temps d'exécution, et il est plafonné
par la limite de corps de requête de la plateforme — 4,5 Mo chez Vercel. Un
boilerplate qui livre ce chemin-là condamne toute story de fichier volumineux.

### C. Un jeton signé porté par la confirmation — rejetée

Pour autoriser la confirmation d'une clé, la première écriture prévoyait un
jeton HMAC émis à la présignature et repassé à la confirmation. Rejetée parce
qu'elle ajoute un second secret à gérer pour une garantie que la **forme de la
clé** donne déjà : la clé est fabriquée sous le préfixe du périmètre de
l'appelant (`avatars/<kind>/<id>/`), et la confirmation vérifie que la clé
reçue est dans ce préfixe. Un appelant ne peut donc confirmer que ce qu'il
aurait pu faire présigner.

## Conséquences

- **Positif** : le critère 5 est tenu à chaque requête, pas à l'émission ; la
  politique de sécurité du contenu livrée reste intacte ; le mode local
  fonctionne sans aucune clé et sans aucune source déclarée.
- **Négatif assumé** : les octets d'un avatar traversent l'application à la
  lecture. Le cache est `private, no-store` — un avatar est une donnée
  personnelle servie derrière une session —, donc chaque affichage est une
  requête. Sur un avatar, c'est négligeable ; sur un futur module de fichiers
  volumineux, il faudra rouvrir cette décision avec un cache HTTP validé par
  `ETag`, pas en présignant la lecture.
- **Négatif assumé** : l'URL de lecture porte un jeton de fraîcheur (`&v=`)
  dérivé de la dernière écriture. Sans lui, un remplacement ne change pas
  l'attribut `src` — l'identifiant de ligne, lui, ne change pas, puisqu'un
  remplacement est **une** écriture — et le navigateur continue d'afficher
  l'ancienne image. Mesuré au navigateur : le parcours de remplacement était
  rouge sans ce jeton, et `cache-control: private, no-store` n'y changeait rien.
- **Dette nommée** : un client qui téléverse puis ne confirme jamais laisse dans
  le seau un objet qu'aucune ligne ne nomme, donc qu'aucune purge ne connaît. Le
  code ne peut pas le fermer — il ne sait pas qu'il existe. La réponse est une
  **règle de cycle de vie sur le seau** (expiration des objets non référencés),
  qui est un geste d'exploitation ; elle est écrite dans `.env.example` et dans
  `packages/modules/storage/AGENTS.md`.
