# Revue — s35-data-export

Story de droit à la portabilité : elle livre une route **publique** qui donne accès à l'ensemble des données d'une personne, et met des données personnelles dans une archive. Le socle de sécurité y pèse plus que les critères fonctionnels. **Deux rondes de revue, trois de correction.**

## Ce que la story était réellement

`exportModules` était **le troisième contrat que le socle déclare et que rien n'appelle** — après la clé `jobs` (fermée par `s33`) et `purgeModules` (fermée par `s34`). Trois stories consécutives, trois fois le même motif : une capacité écrite au contrat, agrégée par le registre, jamais consommée. Après celle-ci, plus aucune clé du contrat de module n'est orpheline.

Et `exportModules` ne gérait **aucun échec** : si un module levait, tout était perdu sans que l'appelant sache où. Plus lourd ici que pour la purge — **un export qui omet silencieusement un module est pire qu'un échec**, parce que la personne croit avoir reçu l'ensemble de ses données.

## Le noyau de sécurité, mesuré à son site

| Mutation | Rouges |
|---|---|
| la signature du lien n'est plus comparée | **1**, sur le **compteur de lectures** — le refus existait déjà, mais *après* une lecture en base |
| l'échéance n'est plus comparée à l'horloge du serveur | 2 |
| la route de téléchargement cesse d'être `public` | **9** — dont le cas qui prouve que la limitation de débit **dérive** de `public` |
| le schéma n'est plus vérifié avant de servir | 1 |
| le verrou consultatif de la revendication est retiré | 1, **sur cinq courses** |
| la purge du contrat n'emporte plus les demandes | 1 — le périmètre *compte* restait vert, seul le périmètre **organisation** compte |

Le premier mérite d'être détaillé : l'empreinte du jeton refusait bien, mais **après** une lecture en base. « Signature vérifiée avant tout effet » n'était donc pas mesurée alors que le refus fonctionnait. Le cas compte désormais les lectures du dépôt, avec contrôle positif. C'est la différence entre *« ça refuse »* et *« ça refuse au bon moment »*.

Vérifié à la source par le relecteur : `routeIsRateLimited` est évaluée **avant** la résolution de session ; le jeton ne porte **que** l'identifiant et la signature — ni échéance, ni périmètre, ni compte, donc rien de réécrivable côté client ; `timingSafeEqual` est protégé par une comparaison de longueur, car il lève sur des tampons inégaux et une exception sur une frontière publique serait un 500.

## Trois majeurs de la ronde 1

**Avec `jobs` coupé, une archive échue n'était jamais effacée — et le code affirmait le contraire.** Mesuré par sonde : demande, horloge avancée au-delà du TTL, seconde demande — la première ligne portait toujours `status=ready` et une copie JSON complète des données. Le profil minimal coupe `jobs` : configuration livrable. Fermé par un oubli **opportuniste** en tête de `requestDataExport`, qui porte sur **toutes** les archives échues et non celles du demandeur — une personne partie n'attend pas son propre retour.

**Résidu écrit plutôt que tu** : un déploiement sans ordonnanceur où plus personne ne demande d'export garde ses archives échues jusqu'à l'effacement du compte. Sans ordonnanceur, il n'existe aucun instant où du code s'exécute. Jugé acceptable : l'accès meurt à l'échéance côté serveur, indépendamment de toute tâche.

**Une prose qui décrivait une reprise que le code refuse.** Le balayage prétendait reprendre les demandes dont la mise en file avait échoué — or celles-ci sont closes sur place et `listPending` ne les rend plus. L'événement `auth.data_export_deferred` disait « différée » d'une demande close ; renommé `…_refused`, aligné sur `s34`.

**La route de demande était la seule route authentifiée coûteuse sans limitation.** Une session valide pouvait boucler : chaque tour parcourait tous les modules, écrivait une copie complète en `jsonb` et envoyait un email. Le dépôt avait déjà tranché ce cas — la route de téléversement de `storage` déclare une politique *« parce qu'une session n'est pas une limite »*. Politique `dataExport` : 3600 s, 20 par appelant, **aucun seau par sujet**.

**La justification du « par appelant seulement » a été vérifiée contre le code** : `RouteRateLimit` ne construit le seau par sujet que depuis un champ du corps ou un cookie, et le garde reçoit `{ route, request }` sans la session. Le périmètre d'un export venant de la session, un seau par sujet aurait été **choisi par l'appelant** — donc aucune limite.

## Ce que la mesure a corrigé, dans les deux sens

**L'implémenteur a corrigé le relecteur.** La ronde 1 supposait qu'une construction concurrente produirait un lien mort. Mesuré : le jeton **dérive de l'identifiant par HMAC**, il n'est pas tiré au hasard — les deux constructions produisent le même jeton et la même empreinte, donc **le lien du perdant fonctionne**. Le défaut réel est un doublon d'email et un export payé deux fois. Corrigé quand même, diagnostic rectifié.

**Et l'implémenteur s'est corrigé lui-même.** Il avait écrit que le démarrage refusait une période de balayage inutilisable. Mesuré : `*/0` est refusé, **`*/90` est accepté** et dégénère en « minute zéro de chaque heure ». La dérive est bornée du bon côté — la fenêtre dangereuse est celle où le balayage reprend une demande encore en exécution, qu'un balayage plus espacé manque de plus loin. Écrit tel quel.

**Deux cas sont revenus verts avant de mordre**, avec les deux chiffres rapportés à chaque fois. Le plus instructif : l'horloge du test étant figée, `requestedAt < maintenant` était faux **par égalité stricte** — retirer le seuil ne changeait rien. Le cas avance désormais l'horloge d'une minute.

## Le plancher, devenu indépendant de la configuration

D'abord `declaring.length > 0` : il n'attrapait que l'effondrement total — cinq des six modules déclarants pouvaient cesser sans que rien ne rougisse. Remplacé par une dérivation : **tout module qui détient des tables déclare une catégorie, ou est nommé avec sa raison**. Deux exceptions, `jobs` et `rate-limit`, dont les clés sont des condensats.

Morsure vérifiée : `billing` cessant de déclarer ses quatre catégories donne **2 rouges le nommant**, contre **0** avec l'ancien plancher.

**Et la justification des exceptions a été affaiblie sur demande, parce qu'elle était juridiquement trop forte.** Elle disait « aucune requête ne peut y relier une ligne à une personne » — faux pour un condensat à faible entropie : on hache un candidat et on regarde si la ligne existe. C'est de la **pseudonymisation**, le mot est désormais écrit, avec la raison qui justifie réellement l'exception.

## Une décision forcée par un rebase

La branche précédait la fusion de `s34`. Au rebase, `admin` a déclaré `grant-authorship` sans l'exporter, et **le garde écrit par cette story a rougi dessus** — `expected [ 'admin' ] to deeply equal []`.

Tranchée : la catégorie ne désigne pas le rôle du bénéficiaire, mais **l'empreinte de l'auteur portée par la ligne d'un tiers**. L'exporter à l'auteur lui remet des identifiants de comptes qui ne sont pas les siens ; l'exporter au bénéficiaire ne lui apprend rien de lui-même. Même lecture que le choix d'`anonymize` en `s34`.

**Limite écrite plutôt que tue** : un superadmin qui exporte ses données **n'y lit pas qu'il l'est**, le rôle ne déclarant aucune catégorie. Manque de portabilité réel, hors périmètre, jugé tel par la revue.

## Un port supprimé plutôt qu'ajouté

`s34` a rendu le port de tâches d'`auth` obligatoire ; l'implémenteur a **supprimé sa propre dépendance** — *« deux ports pour deux tâches du même module auraient été deux vérités sur où s'exécute une tâche »*. Conséquence tirée sans qu'on la demande : une mise en file refusée doit **clore la demande et répondre 503**, sinon le périmètre reste bloqué derrière une demande éternellement « en cours » et le critère 7 refuse toutes les suivantes.

## Non vérifié

**Aucun tiers réel.** Inngest, Resend et S3 sont des doubles ou du disque local. Le scénario que le balayage existe pour rattraper — événement perdu, processus tombé — a été simulé par un double qui met en file sans exécuter.

**Les nombres de la politique n'ont jamais été éprouvés** contre le vrai compteur PostgreSQL : le cas prouve que le répartiteur **consulte** le garde, pas que 3600/20 tient. Et « laisse largement la place à un réseau d'entreprise » reste une affirmation — le seau est global quand aucun proxy de confiance ne renseigne l'adresse.

**Aucun écran.** La story ne livre pas d'interface : ce droit RGPD s'exerce aujourd'hui par appel d'API, comme l'effacement de `s34`. **La taille de l'archive n'est bornée par rien** — pas de limite sur la colonne, pas de délai sur le téléchargement, aucun jeu d'essai réaliste.

Max severity: major
Ship allowed: yes
