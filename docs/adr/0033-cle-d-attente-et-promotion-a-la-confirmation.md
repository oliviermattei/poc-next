# ADR 033 — Une URL présignée ne désigne jamais l'objet servi

- Status: accepted
- Date: 2026-09-01
- Scope: story s18-file-storage-avatar (posée par la revue de la même story)

## Context

L'ADR 032 pose que la vérification du contenu réel a lieu **à la confirmation**,
en relisant l'objet par le port : c'est le seul moment possible, puisque les
octets ne traversent pas l'application et qu'aucune signature ne lie un en-tête
`Content-Type` à un contenu.

La revue de s18 a mesuré, sous le build de production, que ce contrôle **n'est
pas durable** :

```
PUT initial = 200 · confirm = 200
REJEU de l'URL présignée après confirmation = 200
GET /file = 200 · content-type = image/png
octets servis = "<svg xmlns=... onload=\"alert(1)\"/> "
```

Des octets arbitraires, de **même longueur** et sous le même type signé,
remplacent l'objet vérifié, et la route de lecture les sert. La signature lie le
type et la taille — donc la longueur reste vraie et le type servi reste celui
enregistré —, mais « ce qui a été validé » et « ce qui est servi » cessent
d'être la même chose dès que l'URL est rejouée dans sa fenêtre.

Ce n'est pas un défaut du mode local : **aucun fournisseur ne permet de révoquer
une URL présignée**. Elle vaut jusqu'à son échéance, et c'est vrai à l'identique
d'un vrai seau S3 ou R2.

Ce que le dépôt tient par ailleurs, et qui borne la gravité : `nosniff`, le
`content-type` pris **en base** et non chez le fournisseur, `content-disposition:
inline`, `default-src 'self'`. Le navigateur n'exécute rien. Le défaut est une
perte d'intégrité du contenu servi, pas une exécution.

## Decision

**Deux espaces de clés, et l'URL présignée ne connaît que le premier :**

- `pending/<kind>/<id>/<hasard>.<ext>` — la **clé d'attente**, la seule qu'une
  URL présignée nomme ;
- `avatars/<kind>/<id>/<hasard>.<ext>` — la **clé servie**, écrite par le
  serveur.

À la confirmation, l'application lit l'objet d'attente, vérifie ses octets, puis
**écrit elle-même les octets qu'elle vient de vérifier** vers la clé servie
(`Storage.write`), retire l'objet d'attente, et enregistre la ligne sur la clé
servie. La ligne ne porte donc jamais une clé qu'une URL présignée peut
atteindre.

Trois conséquences directes :

1. **le port `Storage` gagne une quatrième opération, `write`.** Son en-tête le
   prévoyait — « le jour où l'un l'est, toutes les implémentations doivent le
   porter » —, et les deux implémentations la portent. Elle n'est **pas** la
   voie d'un téléversement : les octets d'un fichier reçu du navigateur ne
   traversent toujours pas l'application (critère 2, ADR 032, option B rejetée).
   Ce sont des octets **déjà en notre possession**, plafonnés à deux
   mébioctets, que l'on vient de lire pour les vérifier ;
2. **la fenêtre entre la lecture et l'écriture est fermée.** L'objet promu est
   la copie mémoire déjà validée, pas une seconde lecture du seau : un rejeu qui
   arriverait entre les deux réécrit l'objet d'attente, que plus rien ne
   promeut ;
3. **confirmer deux fois la même clé d'attente rend 404 la seconde fois** — elle
   a été consommée. L'invariant qui compte est mesuré à côté :
   l'avatar enregistré n'a pas bougé.

## Options considérées

### A. Réduire la durée de vie de l'URL présignée — rejetée

Deux minutes, dix secondes : la fenêtre rétrécit, elle ne se ferme pas. Un
téléversement lent la rouvre par nécessité, et la garantie devient une question
de bande passante. C'est le même raisonnement que l'ADR 032 tient contre l'URL
présignée de lecture : « une durée courte réduit la fenêtre, elle ne change pas
la nature ».

### B. Un jeton d'usage unique consommé par la confirmation — rejetée

Il empêcherait de **confirmer** deux fois, pas de **réécrire** l'objet : l'URL
présignée resterait valable, et un rejeu postérieur à la confirmation
remplacerait toujours l'objet référencé par la ligne. Il ferme la mauvaise
moitié du problème, et ajoute un second secret à gérer — c'est déjà pourquoi
l'option C de l'ADR 032 a été rejetée.

### C. Relire et revérifier les octets à chaque service — rejetée

Elle rendrait le contrôle exact à chaque requête, au prix d'une vérification de
contenu sur **chaque affichage** d'avatar, sur un chemin déjà critiqué pour
faire transiter les octets par l'application (ADR 032, « négatif assumé »). Elle
déplace un coût de téléversement, rare, vers un coût de lecture, fréquent.

### D. Une copie côté fournisseur (`CopyObject`) plutôt qu'une écriture — rejetée

Elle éviterait de faire remonter les octets… qu'on a déjà en mémoire, puisque la
vérification vient de les lire. Surtout, elle rouvre la fenêtre que la décision
ferme : entre la lecture vérifiée et la copie, un rejeu de l'URL présignée
remplace la source, et la copie promeut alors des octets que personne n'a
vérifiés. Elle demanderait en plus une cinquième opération au port.

## Conséquences

- **Positif** : ce qui est servi est exactement ce qui a été vérifié, et cela ne
  dépend d'aucune garantie du fournisseur. `pnpm test` le tient — le rejeu de
  l'URL présignée après confirmation est un cas de `tests/storage.test.ts`, et
  retirer la promotion fait rougir cinq cas ;
- **Négatif assumé** : un avatar accepté est écrit deux fois dans le seau (le
  dépôt du navigateur, puis la promotion) et lu une fois. Sur deux mébioctets au
  maximum, à la fréquence d'un changement de photo de profil, c'est négligeable.
  Sur un futur module de fichiers volumineux, cette décision devra être rouverte
  — la réponse y sera probablement la vérification différée par un job, pas le
  retour à la clé unique ;
- **Dette nommée, inchangée mais élargie** : un client qui téléverse et ne
  confirme jamais — ou qui rejoue son URL présignée après coup — laisse un objet
  d'attente qu'aucune ligne ne nomme, donc qu'aucune purge ne connaît. La
  réponse reste une **règle de cycle de vie sur le seau**, geste d'exploitation
  écrit dans `.env.example` et dans `packages/modules/storage/AGENTS.md`. Le
  préfixe `pending/` la rend d'ailleurs plus simple à écrire qu'avant : elle
  vise un préfixe entier, et aucun objet servi n'y vit.
