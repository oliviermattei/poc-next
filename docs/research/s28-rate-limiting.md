# Research — Story s28-rate-limiting

## Le fait qui commande la story : deux compteurs existent déjà, et s24 a écrit ce qu'il fallait en faire

`packages/modules/billing/src/schema.ts:386-391` porte ceci, écrit lors de s24 :

> « **Dette nommée**, la même que celle de `public_form_throttle` : la limitation
> de débit appartient à s28. Cette table porte volontairement un autre nom que la
> `rate_limit_window` que s28 déclarera, et **s28 devra la supprimer après avoir
> fait converger les points d'entrée vers son port**. »

Deux tables sont donc en place et attendent d'être absorbées :

| Table | Module | Story |
|---|---|---|
| `public_form_throttle` | `marketing` | s11 |
| `billing_checkout_throttle` | `billing` | s24 |

Les notes de la story disent la même chose autrement : « **Absorbe toute
limitation locale : aucune autre story n'écrit son propre compteur.** »

## La contradiction à trancher : « supprimer » contre « ajouter avant de lire »

s24 écrit que s28 **supprimera** sa table. Mais `docs/reliability.md` impose que
les migrations soient « rétrocompatibles avec la version encore en ligne : ajouter
avant de lire, **cesser d'écrire avant de supprimer** ».

Supprimer `billing_checkout_throttle` dans la même livraison que la bascule
casserait la version encore en service, qui y écrit toujours pendant le
basculement — et s27 vient précisément de mesurer que le basculement n'est pas
instantané.

**La séquence correcte tient en deux temps**, et seul le premier appartient à
cette story :

1. **s28** : créer le port et sa table, faire converger tous les points d'entrée,
   **cesser d'écrire** dans les deux anciennes tables. Elles restent, vides et
   inertes.
2. **Une story ultérieure** : les supprimer, une fois qu'aucune version en ligne
   ne les écrit plus.

Le plan doit l'écrire, sans quoi un agent lira « s28 devra la supprimer » et le
fera dans la même migration.

## Les cinq faits structurants

1. **Le port n'existe pas.** `packages/ports/src/` ne contient que `mailer.ts`,
   `payments.ts`, `storage.ts`. `AGENTS.md:159` déclare pourtant « rate limiting
   PostgreSQL » dans la liste « une implémentation par port » : s28 crée le
   **quatrième** port, et il hérite du contrat — aucune méthode ne lève, l'échec
   est une valeur.
2. **28 routes publiques déclarées**, réparties ainsi : `auth` **18**,
   `billing` 3, `demo-disabled` 2, `demo-enabled` 2, `marketing` 2,
   `consent` 1. Le gros du travail est donc sur `auth`, et `auth` est
   `requiredModules` — non désactivable. C'est cohérent avec la note : « socle
   non désactivable ; optionnel, il laisserait toute installation par défaut
   exposée ».
3. **Le critère 3 règle le cas d'un module coupé** : « un point d'entrée
   appartenant à un module non activé n'est simplement pas enregistré, sans
   erreur au démarrage ». s26 vient de livrer exactement le mécanisme qui le
   prouve — la dérivation registre → attendus — et la recette de profil minimal
   l'exercera gratuitement.
4. **Le critère 7 exige une preuve de partage entre instances** : « un test le
   prouve en simulant deux instances contre le même magasin ». C'est ce qui
   distingue un compteur PostgreSQL d'un compteur en mémoire, et s24 a déjà écrit
   cette mutation pour son propre seau — « compteur de débit en mémoire de
   processus » → 6 rouges. Le motif est établi.
5. **Le critère 8 interdit une échappatoire par variable d'environnement** :
   « neutralisables dans les tests par injection, sans variable d'environnement
   exploitable en production ». C'est une leçon que ce dépôt a déjà payée deux
   fois cette session — `SKIP_ENV_VALIDATION` qui traverse un clone (s26), puis
   qui traverserait une image (s27). Une variable qui désactive une protection
   **est** une porte.

## Pièges & contraintes

- **Limiter par IP seule est insuffisant** contre le bourrage d'identifiants : le
  critère 1 impose « par IP **et** par compte visé ». Un attaquant qui essaie un
  mot de passe sur dix mille comptes depuis dix mille adresses passe sous un
  seuil par IP.
- **L'identifiant d'appelant vient d'un en-tête que l'appelant écrit.** s24 l'a
  déjà rencontré : `x-forwarded-for` est déclaratif. Le seuil par IP est donc une
  gêne, pas une barrière — et c'est pour cela que le critère 1 exige aussi le
  seuil par compte.
- **L'IP est une donnée personnelle.** Les deux tables existantes stockent un
  **condensat** et le disent : « l'identifiant d'appelant n'entre jamais en clair
  dans cette table ». Mais le critère 6 demande que le dépassement soit
  « journalisé avec l'IP et la route » — la journalisation et le stockage n'ont
  donc pas la même règle, et le plan doit le trancher explicitement.
- **Le captcha est optionnel** (critère 5), donc c'est un port de plus ou une
  dégradation propre. « Désactivé, les formulaires restent pleinement
  fonctionnels » interdit qu'il devienne une dépendance dure.
- **429 avec `Retry-After`** : un en-tête, donc une frontière — et une valeur qui
  divulgue la fenêtre. C'est acceptable et normalisé, mais il doit être cohérent
  avec le seuil réel, sinon il ment.
- **Le compteur est sur le chemin de chaque requête publique.** Une écriture
  PostgreSQL par tentative de connexion est un coût, et un point de contention.

## Questions ouvertes

- **Où vit le seuil ?** Le critère 4 dit « dans la configuration, jamais en dur ».
  Un fichier `config/` de plus, ou une clé dans `config/security.ts` ?
- **Que fait-on quand le magasin est indisponible ?** Refuser tout (sûr, mais une
  panne de base coupe la connexion) ou laisser passer (disponible, mais la
  protection s'évapore au pire moment). Le socle fiabilité dit « un tiers absent
  dégrade, il ne casse pas » — mais ici le « tiers » est notre propre base, dont
  l'absence casse déjà tout le reste.
- **Le seuil par compte se compte sur quoi ?** L'adresse email tentée, qui peut
  ne correspondre à aucun compte. Compter sur une adresse inexistante est un
  vecteur d'énumération inversé : l'attaquant apprend qu'une adresse est protégée.
- **Le captcha : lequel ?** Un fournisseur tiers ajoute une origine à la CSP, ce
  que l'ADR 027 refuse par défaut.

## Complexité réelle

`docs/stories.md` annonce **3**. Après lecture : **4**.

Le compteur lui-même est simple — s11 et s24 l'ont écrit deux fois. Ce qui pèse :
**28 points d'entrée** à faire converger sans en oublier, dont 18 sur le module
du socle ; un **port neuf** avec son contrat ; une **absorption** de deux
implémentations existantes, avec une migration en deux temps dont un seul
appartient à cette story ; et un critère de sécurité — la double limitation IP et
compte — que la moitié des implémentations réelles rate.

Pas de découpe : livrer le port sans faire converger les points d'entrée
laisserait trois compteurs au lieu de deux.
