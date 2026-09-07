# killer-saas

Un boilerplate SaaS modulaire : Next 16, React 19, Tailwind v4, PostgreSQL 16 +
Drizzle, Better Auth, Stripe. Chaque fonctionnalité est un **module** qu'on
active ou qu'on coupe depuis `config/features.ts`.

Ce fichier ne sert qu'à une chose : **ouvrir le produit et le regarder**. La
suite se lit dans `AGENTS.md` (les règles), `docs/architecture.md` (la
technique) et `docs/deployment.md` (la mise en production).

## Ouvrir le produit

Prérequis : Node ≥ 20.10, pnpm ≥ 10, et Docker pour la base (aucun PostgreSQL à
installer).

```bash
cp .env.example .env      # aucune clé de fournisseur n'est nécessaire : les modes locaux sont armés
docker compose up -d      # PostgreSQL 16 sur le port 5432
pnpm install
pnpm db:migrate           # les migrations des modules activés, dans l'ordre du graphe
pnpm db:seed              # les données de démonstration
pnpm dev                  # http://localhost:3000
```

Puis **connectez-vous** sur `/sign-in` :

| Adresse | Mot de passe | Ce que ce compte a |
|---|---|---|
| `ada@demonstration.invalid` | `demonstration-seulement` | propriétaire de l'organisation « Atelier Démo », un abonnement, trois notifications |
| `hedy@demonstration.invalid` | `demonstration-seulement` | membre de la même organisation |

Aucune inscription, aucun email à aller lire sur le disque : les comptes semés
sont **déjà vérifiés**. Ce raccourci-là est mesuré — `tests/seed.test.ts` ouvre
une session avec ce compte par la route de connexion ordinaire, pas par un
chemin de test.

Les adresses sont en `.invalid`, un domaine que la RFC 2606 réserve et qui ne
peut recevoir aucun courrier ; le mot de passe est dans le dépôt, donc public
par construction. Ce qui empêche ces comptes d'atteindre une base en service
n'est pas leur contenu : **`pnpm db:seed` refuse dès que la base porte un compte
qu'il n'a pas créé lui-même**. Un produit en service en a toujours un.

Le seed est **rejouable** : deux exécutions successives laissent le même nombre
de lignes, et la commande l'imprime (« *n* avant, *n* après »). Elle **échoue**
si aucun module activé n'a de données à semer, et si l'un d'eux en déclare sans
en écrire aucune sur une base neuve — elle le nomme alors. Une commande de seed
qui sort verte sans rien semer est ce que cette recette a corrigé.

### Voir le back-office

Le back-office (`/admin/users`) répond 404 à tout le monde tant qu'aucun
superadmin n'existe. Le premier se désigne par une variable, et seulement tant
qu'il n'y en a aucun :

```bash
# dans .env
SUPERADMIN_EMAIL=ada@demonstration.invalid
```

Redémarrez `pnpm dev`, reconnectez-vous, et l'entrée « Administration » apparaît
dans la navigation.

### Ce que la démonstration ne montre pas

- **Les paiements** ne parlent à personne : `PAYMENTS_LOCAL_MODE=1` simule le
  tunnel. L'abonnement semé est une ligne locale, aucun identifiant n'existe
  chez Stripe ;
- **les emails** ne partent pas : `EMAIL_LOCAL_CAPTURE=1` les écrit sur le
  disque plutôt que de les envoyer ;
- **le blog, la documentation et le changelog** ne sont pas semés : leur contenu
  est livré en MDX, il est déjà là.

## Ensuite

```bash
pnpm ks list              # les modules, activés ou non
pnpm ks toggle <module>   # en couper un, ou le rallumer
pnpm test                 # la suite unitaire et de câblage
pnpm test:e2e             # les parcours navigateur
```

Le tableau complet des commandes, et ce qui fait échouer chacune, est dans
`AGENTS.md`.
