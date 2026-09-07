# Review — s37c-inscriptions-publiques

> Contexte neuf. Diff jugé : 34 fichiers, +2202/−30, commit `bc068b0`.

## Ce que la revue a joué elle-même

`pnpm test` **2966 verts**, 104 fichiers, base réellement atteignable · `typecheck` · `lint` · `E2E_PORT=3237 pnpm test:e2e` **125 verts** · `pnpm test:minimal-profile` 6/6 · **`pnpm test:socle` ÉCHOUE** — constat 1.

## Anti-hallucination

Aucune API inventée. Chaque import ouvert et vérifié. Aucune valeur plausible-mais-fausse : le séparateur, le CRLF, le guillemet doublé et la marque d'ordre d'octets sont conformes à RFC 4180 et à ce qu'attend un tableur français ; les statuts 503, 404 et les en-têtes tiennent sur le vrai chemin HTTP.

**Les deux affirmations de l'implémenteur, rejouées** : la mutation de l'enveloppe de route est bien **verte** — la garde du cas d'usage refuse quand même, c'est de la défense en profondeur et non un trou — et neutraliser cette enveloppe **pour toutes les routes** donne 8 rouges. Aucune des deux gardes n'est non mesurée ; seule la redondance de cette route l'est. En revanche la mutation de la garde unique rougit **27 cas, pas 28** (constat 3).

## Conformité aux règles

**Contrôle 1 passé** : `admin` ne déclare, n'importe ni ne lit `marketing` — vérifié dans le `package.json`, et un test l'asserte. **Contrôle 2** : une seule garde, définie une fois. **Contrôle 3** : 404 et jamais 403, sur le vrai chemin HTTP, plus un second contexte navigateur. **Contrôle 4** : la liste des sources est groupée sur la colonne ; coder la liste en dur rougit. **Contrôle 5** : l'entrée disparaît, dérivée du registre.

Sécurité : Zod à la frontière et borné, requête paramétrée, jokers `LIKE` échappés, autorisation avant toute lecture, aucun secret en en-tête.

## Mutations — dix, à leur propre site

Retirer l'assainissement rougit **2 fois** — sur la chaîne rendue **et** sur le fichier servi en HTTP. Cesser de doubler le guillemet interne : 2. La garde unique : **27**. L'en-tête de disposition : 1. Le filtre de source côté requête : 1, contre un vrai PostgreSQL. L'échappement des jokers : 1. Le nom de fichier recopiant la source brute : 1. La liste de sources écrite en dur : 1.

## Le balayage P30 — un second endroit où du texte hostile atteint un fichier, un nom ou un en-tête

Cinq puits balayés : le nom de fichier, le corps CSV, les en-têtes, et les deux constructeurs de liens. Le nom est **dérivé, jamais recopié** ; le corps passe **chaque** cellule par l'assainisseur, sans exception ; les liens passent par `URLSearchParams`. **Aucun second puits trouvé** — c'est ce qui a été balayé, sur ces cinq, et non une affirmation qu'il n'en existe pas d'autre.

## Constats

**1. critical — le nouveau parcours navigateur casse la branche `socle` de la CI.** Sa préparation exécute inconditionnellement un `delete` puis un `insert` sur la table des inscriptions publiques. Or la CI joue le job **deux fois**, et la seconde coupe `marketing` — donc la table n'existe pas :

```
1 failed  › le back-office liste les inscriptions et en sert un CSV assaini
  [cause]: error: relation "public_subscription" does not exist
106 passed
```

Toutes les étapes antérieures passent dans la copie ; seul ce test est rouge. Le motif établi tient en une ligne — deux specs du dépôt sautent déjà sur la coupure de leur module. **C'est le mode d'échec « une garde qui ne mord que dans une configuration », dans sa forme la plus littérale : la story laisse rouge son propre critère de module coupé.**

**2. major — le filtre de source est silencieusement perdu par la pagination et par la recherche.** Les liens de pagination ne portent que la page et la recherche ; le formulaire de recherche est un `GET` qui remplace toute la chaîne de requête. Mesuré sur le rendu :

```
liens de pagination : [ '/admin/subscriptions?page=1' ]
formulaire : action="/admin/subscriptions" method="get" … name="q"
```

Un superadmin qui filtre une source puis pagine — ou cherche — atterrit sur la liste **non filtrée**, alors que le nombre de pages a été calculé sur le total filtré. Le fichier énonce **cet invariant exact** pour la recherche deux lignes plus haut, et le filtre énonce son miroir. Seules les directions source→pagination et source→recherche manquent.

**3. minor — un compte écrit qui vaut 27 et non 28**, dans un règlement de package, sous une règle racine qui interdit précisément d'écrire un compte à côté du code. Les cinq autres mesures de cette table sont exactes.

**4. minor — le plan nomme la mauvaise recette** : `pnpm test:minimal-profile` ne coupe pas `marketing`. Celle qui le coupe est `pnpm test:socle` — et c'est celle qui est rouge.

**5. minor — une raison écrite fausse** : le commentaire du nouveau parcours dit que le balayage générique ne vise que les routes publiques ; il balaie aussi les `GET` non publics, donc cette route y entre gratuitement. Le test garde sa valeur — le cas du connecté non-superadmin —, c'est la justification qui est inexacte.

**6. minor — aucun `docs/designs/` pour une story qui livre un écran**, comme la story précédente de la même famille. Le manque de composant est correctement **reporté** et non comblé. Une incohérence dans la copie : la variante de bouton au repos n'a ni bordure ni fond, là où l'écran dont elle s'inspire en a une — **les sources non sélectionnées se rendent en texte nu**, et personne ne l'a vu dans un navigateur.

**7. minor — l'export est sans borne, sans limite de débit et sans plafond.** Conforme aux règles telles qu'elles sont écrites, et le plan a choisi d'**écrire** la limite plutôt que de la résoudre — le code le dit à trois endroits, dont « aucune commande ne tient cette phrase ». L'appelant est un superadmin : la surface d'abus est l'acteur le plus fiable du produit.

## Non vérifié

- **L'écran n'a jamais été rendu dans un navigateur**, par personne : le parcours asserte des rôles et du texte, et la configuration démarre le serveur de développement, **pas le build de production**.
- **Le CSV n'a jamais été ouvert dans un vrai tableur.** Le préfixe, le séparateur et la marque d'ordre d'octets sont assertés sur la chaîne d'octets, jamais contre Excel, LibreOffice ou Numbers. **Aucune adresse accentuée n'a été exportée puis rouverte** — donc la raison d'être de la marque d'ordre d'octets n'est pas éprouvée de bout en bout.
- **L'affirmation de volume est intestable par construction** : la lecture sans borne a été exercée sur trois ou quatre lignes.

**Gestes humains** : couper `marketing` et rejouer le parcours ; ouvrir l'écran à 1280 et 390 px dans les deux thèmes et juger si la rangée de sources se lit comme un jeu de filtres ; sur cet écran, choisir une source puis cliquer page 2, puis chercher — le constat 2, vu plutôt que lu ; et télécharger le CSV avec une adresse accentuée et une commençant par `=`, puis l'ouvrir dans Excel **et** LibreOffice.

## Verdict

La surface de sécurité pour laquelle cette story existe — l'injection de formule — est réellement résolue et réellement mesurée **sur le fichier produit**, à deux niveaux, et elle rougit quand on la neutralise. La garde est unique, refuse en 404, et mord à son propre site.

Ce qui bloque n'est pas la partie difficile : c'est une ligne de saut manquante qui rend rouge la moitié de la matrice de CI, et un filtre qui tombe de l'URL au second clic.

---

# Revue — ronde 2, après la passe de correction

> Contexte neuf. Diff jugé : 35 fichiers, +2456/−32. Le commit de la ronde 1 restant atteignable, **la passe de correction elle-même est auditable** : 7 fichiers, +270/−18.

## Ce que la revue a joué

`pnpm test` **2967 verts** · `typecheck` 37/37 · `lint` propre · **`pnpm test:socle` exit 0**, mesuré explicitement : 2960 unitaires, **109 parcours, 0 échec**, arbre propre, audit propre · **`test:socle` sous mutation : exit 1, exactement 1 échec**, le nouveau cas.

## Le critique est fermé, et la paire se comporte comme prévu

Dans le journal de la recette : le parcours CSV **sauté**, le cas de disparition **vert**. Le saut est dérivé de la même donnée que lit la garde de la page, pas d'un identifiant de module recopié — et le précédent invoqué est réel et symétrique dans deux specs du dépôt. La branche coupe `marketing` mais garde `admin` : le nouveau cas **n'est donc pas vert pour la mauvaise raison**.

**Et le cas symétrique mord, avec quelque chose qui lui est propre.** En déplaçant la garde de module **sous** la redirection de session — comportement inchangé pour un connecté, changé pour un anonyme — la recette rend **1 rouge, et c'est ce cas** : `Expected 404, Received 200`. La suite unitaire, elle, reste verte sous cette mutation : exactement ce que le commentaire de la passe affirme.

## Le correctif du filtre, mesuré sur le rendu des trois listes

Les liens de pagination portent la source, le formulaire porte son champ caché, **et les deux autres listes n'ont aucun champ caché ni aucune forme de lien modifiée**. Cinq mutations, chacune à son site : le filtre côté formulaire **1**, côté pagination **1**, la garde unique **27**, l'assainisseur **2** (chaîne rendue *et* fichier servi), la moitié marketing de la garde **1**.

## Les corrections dues, vérifiées une par une

Le compte de 27 est exact. Le plan nomme désormais la bonne recette, et la raison est vérifiée contre le profil. La justification du commentaire de parcours est devenue vraie — le balayage couvre bien ce `GET` pour l'appel anonyme, et le nouveau cas couvre le connecté sans rôle. **L'autocorrection P30 est confirmée** : le commentaire ne prétend plus qu'une moitié de garde n'est tenue par rien, et la revue a re-mesuré la moitié en question.

## Constats restants

**1. minor** — un bloc de documentation orphelin : deux blocs se suivent, et celui qui décrit le lien d'export ne pointe plus sur lui.

**2. minor — une affirmation légèrement plus large que son balayage** : « plus d'entrée, plus de route » — la route l'est réellement, l'**entrée** ne l'est que sur la surface principale, où une entrée de back-office ne paraît jamais. Aucune exécution ne rend la navigation du back-office avec `marketing` coupé. L'absence est **structurelle**, ce qui est bien ; c'est la phrase qui se lit comme mesurée.

**3. minor** — le test de rendu cherche les champs cachés dans **toute la page** plutôt que dans le formulaire : un champ déplacé hors du formulaire garderait le test vert. Il rougit sous les deux mutations aujourd'hui — il est plus étroit que son nom.

**4. minor** — toujours aucun `docs/designs/`, et la preuve navigateur du changement de variante **ne vit nulle part dans le dépôt** : c'est une affirmation dans un message, pas un artefact.

**5. minor** — la liste des caractères déclencheurs est **recopiée** dans le test au lieu d'être importée, à côté d'un commentaire qui écrit leur nombre. Elle mord dans le bon sens, mais un septième déclencheur ne serait balayé par rien.

**6. minor, porté et délibéré** — l'export reste sans borne, sans limite de débit et sans plafond, conforme aux règles écrites, avec un superadmin pour appelant.

## Non vérifié

**L'écran n'a toujours été rendu par personne dans un navigateur sous build de production.** Le geste « choisir une source puis chercher » a été mesuré sur le HTML rendu, jamais cliqué. **Le CSV n'a jamais été ouvert dans un tableur** : la raison d'être de la marque d'ordre d'octets reste inéprouvée de bout en bout. Et la recette a tourné sur ce poste, pas sur un runner.

## Verdict

Le défaut bloquant est parti à sa racine et au niveau qui compte : la recette est verte de bout en bout, le saut est dérivé plutôt que recopié, et le contre-cas ajouté n'est pas décoratif — déplacer la garde le rend rouge, lui et lui seul. Le filtre survit désormais à la pagination et à la recherche, dans les deux sens, sans que les composants partagés aient appris le vocabulaire d'une liste, et les deux autres listes sont prouvées intactes.

Restent cinq mineurs, dont quatre portent sur des mots plutôt que sur des comportements.

Max severity: minor
Ship allowed: yes
