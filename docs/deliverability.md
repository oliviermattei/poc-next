# Délivrabilité des emails transactionnels

Un domaine d'envoi sans authentification voit ses emails classés en indésirables
ou refusés en silence. C'est le mode de panne le plus coûteux du moteur
d'emails : la vérification d'inscription n'arrive jamais, l'utilisateur croit
que le produit est cassé, et **aucune erreur n'apparaît nulle part** — le
fournisseur a bien accepté l'envoi, c'est le destinataire qui l'a écarté.

Les trois enregistrements ci-dessous se posent **avant** le premier envoi réel,
dans la zone DNS du domaine expéditeur (celui de `EMAIL_FROM`). Les valeurs
exactes sont données par Resend au moment où le domaine est ajouté ; ce
document dit ce que chacun fait et à quoi ressemble ce qu'on pose.

## SPF — qui a le droit d'envoyer pour ce domaine

SPF liste les serveurs autorisés à envoyer du courrier au nom du domaine. Sans
lui, n'importe qui peut prétendre écrire depuis votre domaine, et les
destinataires n'ont aucun moyen de trancher.

Enregistrement `TXT` à la racine du domaine d'envoi :

```
send.exemple.com.  TXT  "v=spf1 include:amazonses.com ~all"
```

`~all` (softfail) plutôt que `-all` (hardfail) au démarrage : un hardfail posé
avant d'avoir inventorié tous les émetteurs légitimes du domaine (facturation,
outil de support, campagnes) fait disparaître leurs emails du jour au
lendemain. Durcir en `-all` une fois l'inventaire fait.

## DKIM — la signature qui prouve que le message n'a pas été altéré

DKIM signe chaque message avec une clé privée détenue par le fournisseur ; le
destinataire vérifie la signature avec la clé publique publiée dans le DNS.
C'est ce qui survit à un transfert, là où SPF ne survit pas.

Enregistrement `TXT` sur le sélecteur fourni par Resend :

```
resend._domainkey.exemple.com.  TXT  "v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEB…"
```

La clé publique est longue : certains hébergeurs DNS la coupent en plusieurs
chaînes entre guillemets. C'est valide, à condition de ne pas ajouter d'espace
entre les morceaux.

## DMARC — ce qu'on demande de faire des messages qui échouent

DMARC dit au destinataire quoi faire quand SPF et DKIM échouent, et où envoyer
les rapports. Sans lui, chaque destinataire décide seul, et vous n'apprenez
jamais qu'on usurpe votre domaine.

Enregistrement `TXT` sur `_dmarc` :

```
_dmarc.exemple.com.  TXT  "v=DMARC1; p=none; rua=mailto:dmarc@exemple.com; pct=100; adkim=s; aspf=s"
```

Progression recommandée, dans cet ordre, en lisant les rapports entre chaque
étape : `p=none` (on observe) → `p=quarantine` (indésirables) → `p=reject`. Poser
`p=reject` d'emblée bloque les émetteurs légitimes qu'on avait oubliés.

## Vérifier avant d'y croire

```sh
dig +short TXT send.exemple.com
dig +short TXT resend._domainkey.exemple.com
dig +short TXT _dmarc.exemple.com
```

La console Resend affiche le domaine comme « vérifié » une fois les trois
enregistrements propagés. Un domaine non vérifié fait échouer l'envoi avec
`invalid_from_address` — que l'adapter classe en `invalid_request` et **ne
rejoue pas** : la requête est fautive, la rejouer ne la corrigerait pas.

## Les deux régimes d'essai

Le dépôt n'envoie jamais d'email réel depuis une exécution de CI
(`docs/architecture.md`, « deux régimes, jamais mélangés »).

| Régime | Ce qui se passe | Comment |
|---|---|---|
| Développement, capture locale | l'email est rendu et écrit dans `.mail/`, consultable dans un navigateur, et **rien ne part** | `EMAIL_LOCAL_CAPTURE=1`, sans `RESEND_API_KEY` — c'est ce que `.env.example` livre |
| CI | doublure d'enregistrement, réseau doublé, aucun envoi | `pnpm test` |
| Avant un ship qui touche aux emails | envoi réel contre une clé de test | commande ci-dessous |

```sh
RESEND_LIVE_TEST=1 RESEND_API_KEY=re_… \
EMAIL_FROM='Killer SaaS <envoi@exemple.com>' EMAIL_LIVE_TO=vous@exemple.com \
  pnpm vitest run packages/adapters/resend/src/resend-live.test.ts
```

La capture locale est un **choix explicite**, pas ce qui reste quand la clé
manque : sans clé et sans `EMAIL_LOCAL_CAPTURE=1`, l'application refuse de
démarrer en nommant les deux variables. Un déploiement dépourvu de clé écrirait
sinon ses emails sur disque en rendant « envoyé » — la panne la plus silencieuse
qui soit sur un parcours d'inscription. Les deux ensemble sont refusées aussi :
le choix serait ambigu.

C'est cette recette qui prouve la délivrabilité : elle est la seule à faire
sortir un message du dépôt. Lisez l'email reçu et vérifiez, dans son en-tête
d'authentification, que `spf`, `dkim` et `dmarc` valent tous `pass` — un envoi
accepté par Resend n'est pas un envoi délivré.
