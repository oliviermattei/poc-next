# killer-saas

Un boilerplate de SaaS composé de modules autonomes. Ce glossaire fixe les mots
du domaine, et rien d'autre : aucun détail d'implémentation, aucune décision —
celles-ci vivent dans `docs/decisions/`.

## Les personnes

**Superadmin** :
Un membre de l'équipe qui *crée et exploite* le SaaS. Le pouvoir est une ligne
de `admin_platform_role`, relue à chaque requête, jamais un rôle porté par une
organisation.
_Avoid_: Hyperviseur, administrateur, owner, super-admin

**Utilisateur** :
Une personne qui possède un compte sur le SaaS et s'en sert comme client.
Un utilisateur n'est jamais superadmin du fait de son rôle d'organisation.
_Avoid_: Membre (réservé à l'appartenance à une organisation)

**Membre** :
Un utilisateur rattaché à une organisation, avec un rôle `owner`, `admin` ou
`member` dans *cette* organisation. Ce rôle ne donne aucun pouvoir de
plateforme.
_Avoid_: Collaborateur

**Organisation** :
Le locataire du SaaS : l'entité qui porte les membres, l'abonnement et les
données. C'est l'unité de cloisonnement.
_Avoid_: Site, équipe, compte, workspace, tenant

## Les surfaces

**Back-office** :
La surface réservée aux superadmins, servie sous `/admin`. Elle a son propre
châssis : rien de la navigation du produit n'y paraît, et rien d'elle ne paraît
dans le produit.
_Avoid_: Console, panel, hyperviseur, admin panel, wp-admin

**Produit** :
La surface servie aux utilisateurs et aux visiteurs — tout ce qui n'est pas le
back-office.
_Avoid_: App, dashboard (le mot « dashboard » est pris, voir plus bas)

**Dashboard** :
L'écran d'accueil du back-office (`/admin`), qui montre les mesures de santé
commerciale du SaaS.
_Avoid_: Tableau de bord utilisateur, accueil

## L'argent et les gens qui arrivent

**Inscription** :
Une adresse email capturée sur le site public — newsletter, liste d'attente.
Aucun compte, aucun paiement.
_Avoid_: Subscription, abonné, lead

**Abonnement** :
Un contrat récurrent payant entre une organisation et le SaaS.
_Avoid_: Inscription, souscription

**Achat** :
Un paiement unique, sans reconduction.
_Avoid_: Commande, transaction

**Vente** :
Un abonnement créé ou un achat encaissé. Le mot rassemble les deux quand on
compte l'argent qui entre ; il n'inclut jamais les inscriptions.
_Avoid_: Conversion

**MRR** :
Le revenu récurrent mensuel : la somme des abonnements dans un état que la
facturation compte comme payant, ramenée au mois.
_Avoid_: Chiffre d'affaires, revenu

## Les mesures du dashboard

**Connexion (24 h)** :
Une session ouverte dans les vingt-quatre dernières heures. Ce n'est pas un
nombre d'utilisateurs actifs : un compte déjà connecté qui travaille toute la
journée n'y figure pas.
_Avoid_: DAU, utilisateur actif, visite

**Fenêtre glissante** :
Un intervalle qui se termine à l'instant de la lecture — « 24 h », « 30 jours ».
Elle n'a pas de fuseau horaire, contrairement à « aujourd'hui ».
_Avoid_: Période, journée, mois calendaire
