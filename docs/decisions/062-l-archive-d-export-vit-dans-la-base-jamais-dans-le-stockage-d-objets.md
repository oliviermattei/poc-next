# ADR 062 — L'archive d'export vit dans la base, jamais dans le stockage d'objets

- Status: accepted
- Date: 2026-09-06
- Scope: story s35-data-export

## Context

Une archive d'export est une **copie complète des données personnelles d'un
périmètre**, construite pour être remise puis oubliée. Entre sa construction et
son téléchargement, elle est quelque part. Ce « quelque part » décide de ce qui
l'efface.

Deux faits pesaient sur la décision :

1. **s34 a fermé trois trous de la même forme** — une donnée qui nomme un compte
   sans clé étrangère vers lui, et qui survit à son effacement :
   `auth_verification.value` (une adresse), `admin_platform_role.granted_by`
   (l'auteur d'une promotion), `organization_invitation.email`. Aucune cascade
   ne les atteignait ; chacune a demandé un effacement écrit à la main. Une
   archive posée dans un seau d'objets est exactement le quatrième cas, en pire :
   le seau n'a **aucune** clé étrangère, et son contenu est l'intégralité des
   données, pas un champ.
2. **Le module `storage` est optionnel.** `config/profiles.ts` ne le coupe pas
   aujourd'hui, mais rien ne l'en empêche, et la CI ne configure aucun stockage —
   ni seau S3, ni `STORAGE_LOCAL_DIRECTORY`. Un export qui en dépendrait cesserait
   d'exister dans ces configurations, alors qu'il est une obligation légale du
   socle (ADR 061).

## Decision

**L'archive est écrite en JSON dans `auth_data_export_request.archive`, la ligne
même de la demande qui l'a produite.**

Elle en hérite deux effacements, et ce sont des propriétés de la base, pas des
consignes :

- la **cascade** de `requested_by` vers `auth_user` : un compte effacé emporte
  ses archives sans que personne l'ait demandé ;
- la **purge du contrat** (`purge(scope)` du module `auth`), qui efface les
  demandes du périmètre. C'est elle — et elle seule — qui couvre le périmètre
  **organisation**, dont `scope_id` ne porte aucune clé étrangère (ADR 018 :
  `auth` ne référence pas un module qu'il ne requiert pas). Mesuré : neutraliser
  cet appel laisse l'archive complète d'une organisation supprimée en base, et
  le cas du périmètre compte reste vert — la cascade le couvre déjà.

À l'échéance, l'archive est **effacée** et la ligne reste : ce qui n'est plus
téléchargeable n'a plus de raison d'être conservé, et la trace « une demande a eu
lieu ce jour-là » est ce que l'export de la personne rend.

**Deux déclencheurs, et il en fallait deux.** Le balayage de la tâche
`auth.data-export` n'existe que si le module `jobs` est activé — c'est
l'ordonnanceur qui l'appelle sans `requestId`. Or `config/profiles.ts` coupe
`jobs`, et dans cette configuration la tâche n'est **jamais** appelée sans
identifiant : la première rédaction de cet ADR promettait donc un effacement
qu'une configuration livrable n'exécutait pas, ce que la revue a mesuré — archive
échue, `status = ready`, copie JSON complète restée en base. L'effacement est
donc aussi accroché à la **demande d'export** elle-même, qui existe dans toutes
les configurations, et il porte sur **toutes** les archives échues plutôt que sur
celles du demandeur.

**Ce que cela ne couvre toujours pas**, et il faut le lire plutôt que le
supposer : un dépôt sans ordonnanceur où plus personne ne demande d'export garde
ses archives échues jusqu'à l'effacement du compte. Sans ordonnanceur, il
n'existe aucun instant où du code s'exécute. Le lien, lui, refuse dès l'échéance
— cette décision porte sur la **conservation**, pas sur l'accès.

**Corollaire : l'archive est entièrement en JSON.** Le seul module qui possède
des octets est `storage`, et son export rend déjà un **manifeste** — identifiant,
usage, type de contenu, taille, date — sans la clé d'objet, qui nommerait
l'emplacement d'un objet dans un seau (`docs/security.md` §5). Les octets
n'entrent donc pas dans l'archive.

**Ce que le manifeste ne permet pas**, et il faut le lire avant de s'y fier :
il porte la taille mais **aucune empreinte**. Une personne qui reçoit l'archive
peut donc constater *qu'un fichier existe*, son poids et sa date, mais elle ne
peut **ni le télécharger depuis l'archive, ni vérifier que le fichier qu'elle
obtiendra par ailleurs est bien celui-là**. Calculer une empreinte demanderait de
**lire chaque objet** au moment de l'export — autant d'appels réseau sortants
dans une requête — et de changer la forme de l'export d'un module existant, ce
que le plan de s35 exclut. Le jour où la portabilité des octets est demandée,
c'est un nouvel ADR : il faudra un transfert hors requête et une forme d'archive
qui n'est plus du JSON.

## Considered options

- **Le port `Storage` (seau S3/R2, ou disque local)** — rejeté : le seau n'a pas
  de clé étrangère, donc l'archive survivrait à l'effacement du compte à moins
  d'un effacement écrit à la main — le défaut exact que s34 a payé trois fois. Il
  faudrait en plus que le module `storage` soit activé et configuré, ce que la CI
  ne fait pas, et l'export cesserait d'exister dans les configurations qui le
  coupent.
- **Ne rien stocker : reconstruire l'archive à chaque téléchargement** — rejeté :
  le lien deviendrait un déclencheur d'export non authentifié, donc un moyen de
  faire travailler le serveur autant de fois qu'on clique, sur une route
  **publique**. Et l'archive remise ne serait plus celle qui a été construite au
  moment de la demande : deux téléchargements du même lien rendraient deux
  contenus différents, ce qui n'est plus une archive.
- **Un dossier sur le disque du conteneur** — rejeté : le conteneur est jetable
  (`docs/deployment.md`), et deux instances ne partagent pas leur disque. Le lien
  ne fonctionnerait qu'une fois sur deux, sans jamais le dire.
- **Chiffrer l'archive en base avec une clé dérivée du jeton** — écarté pour
  l'instant, pas rejeté : la propriété gagnée est réelle (une copie des lignes ne
  rendrait pas les archives lisibles), mais elle rendrait l'archive irrécupérable
  pour l'exploitant, et le lien devient alors le seul moyen d'en lire quoi que ce
  soit — y compris pour diagnostiquer. À reprendre le jour où le socle porte une
  gestion de clés ; aujourd'hui il n'en a pas.

## Consequences

**Plus facile** : la promesse « aucune donnée personnelle ne survit à
l'effacement du compte » est tenue par la base — une cascade et une purge par
périmètre —, pas par une consigne qu'un futur module devrait relire. L'export
fonctionne dans toutes les configurations, sans clé de fournisseur.

**Plus difficile** : une archive volumineuse est une ligne volumineuse. Un
périmètre qui porterait des dizaines de milliers de lignes ferait un `jsonb` de
plusieurs mégaoctets, lu d'un bloc au téléchargement. Rien ne le borne
aujourd'hui, et rien ne le mesure : c'est la limite à surveiller en premier.

**À surveiller** : le jour où un module exportera de la donnée en volume, cette
décision devra être reprise — pagination de l'archive, ou transfert vers un seau
avec son effacement écrit. Le signal sera une durée de requête, pas une erreur.
