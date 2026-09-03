# Research — Story s25-golden-path-e2e

## La prémisse fausse : il n'existe aucun événement Stripe enregistré

Le critère 6 demande qu'en CI le scénario s'exécute « avec **rejeu d'événements
webhook Stripe enregistrés**, sans appel réseau sortant ». `AGENTS.md` pose la
même règle pour tout le dépôt : « in CI: recording doubles for outbound calls,
**replay of recorded webhook events** for inbound ones, both blocking ».

**Rien de tel n'existe.** Balayage de l'arbre : aucun fichier de charge utile
Stripe enregistrée, nulle part. Ce qui existe est un **simulateur écrit à la
main** — `packages/payments-testing/src/local-payments.ts` fabrique ses
événements (`evt_local_purchase_…`, `evt_local_sub_…`, `evt_local_checkout_…`,
`evt_local_read_…`, lignes 223, 297, 308, 383) avec les champs que **nous**
avons jugés nécessaires.

La différence n'est pas cosmétique. Un simulateur dérive de son modèle en
silence : le jour où Stripe renomme un champ, ajoute une contrainte ou change une
forme, notre simulateur continue de passer au vert pendant que la production
casse. C'est exactement le mode de défaillance que « rejeu d'événements
enregistrés » existe pour fermer, et c'est celui qu'un simulateur ne peut pas
fermer par construction.

**Les critères 6 et 7 sont donc liés, et dans cet ordre** : c'est l'exécution
hors CI, contre les clés de test réelles (critère 7), qui **produit** les
enregistrements que la CI rejoue (critère 6). Un scénario qui se contenterait du
simulateur satisferait la lettre du critère 6 — « sans appel réseau sortant » —
en manquant sa raison d'être.

## Les cinq faits structurants

1. **Le second régime existe déjà**, écrit en s19 :
   `packages/adapters/stripe/src/stripe-live.test.ts`, commandé par
   `STRIPE_LIVE_TEST=1 STRIPE_SECRET_KEY=sk_test_… STRIPE_LIVE_PRICE_ID=price_…`.
   Son en-tête énonce déjà la doctrine des deux régimes et précise qu'« aucun
   paiement n'est encaissé ». Le critère 7 **étend** ce régime au parcours
   complet ; il ne l'invente pas.
2. **Le harnais Playwright pose son environnement lui-même**
   (`playwright.config.ts:68-90`) : `AUTH_SECRET`, `APP_URL`,
   `EMAIL_LOCAL_CAPTURE`, `STORAGE_LOCAL_DIRECTORY`, `I18N_MISSING_KEY_PROBE`
   sont écrits dans `webServer.env` et non laissés au `.env` du poste — une
   leçon mesurée à la fusion de s18. Le parcours doré héritera de ce choix.
3. **Un seul projet Playwright** (`projects: [{ name: 'chromium' }]`) et un seul
   `webServer`. Le critère 2 demande « une base vierge, sans état résiduel »,
   alors que les quinze specs existantes partagent la base du poste. Isoler le
   parcours doré demande soit un second projet, soit une commande séparée.
4. **`pnpm db:seed` existe** (`packages/db`), et le socle fiabilité impose qu'il
   soit rejouable sans effet supplémentaire. Le critère 2 s'appuie dessus.
5. **`e2e/support/warm-up.ts` existe** et compile l'application avant la première
   assertion — « le défaut que ce fichier ferme, mesuré et non supposé : `next
   dev` compile à la demande ». Toute mesure de durée qui ignorerait ce
   préchauffage mesurerait la compilation, pas le parcours.

## Le piège de la mesure

Le critère 4 veut chronométrer « installation des dépendances, configuration de
`.env` depuis l'exemple, migration et seed sur une base vierge », et le critère 5
veut que ce total corresponde au « clone → premier paiement » du PRD.

Or ces gestes sont **déjà faits** dans le dépôt où la commande s'exécutera :
`pnpm install` sur un `node_modules` chaud rend en quelques secondes ce qui prend
plusieurs minutes sur un clone neuf. Chronométrer l'amorçage depuis un arbre déjà
installé produit un nombre **flatteur et faux** — précisément sur la partie que
le boilerplate promet de raccourcir.

Trois issues, à trancher au plan :

- mesurer dans un répertoire temporaire, depuis un `git clone` local et un cache
  pnpm froid — honnête, lent, et dépendant du réseau ;
- mesurer avec le cache pnpm chaud mais `node_modules` absent — reproductible,
  et c'est la situation réelle d'un acheteur qui a déjà utilisé pnpm ;
- ne pas mesurer l'installation et le dire — ce qui contredit la note de la
  story : « la phase d'amorçage **est dans la mesure** : sans elle, le chrono
  journalisé exclurait précisément la partie que le boilerplate promet de
  raccourcir ».

La troisième est exclue par la story elle-même. Le choix entre les deux
premières est le vrai sujet du plan.

## Story visée

« Vérifier le parcours clone → premier paiement ». Complexité annoncée : **3**.
Dépendance : `s24-guest-checkout`, livrée.
Porte le **critère de succès n°1 du PRD** (« clone → premier paiement en moins
de 30 minutes »).

Huit critères : un scénario enchaînant inscription → vérification → organisation
→ souscription → fonctionnalité réservée ; base vierge ; deux variantes (achat
unique, guest checkout) ; amorçage mesuré ; trois durées journalisées ; régime CI
bloquant par rejeu enregistré ; régime hors CI sur clés réelles, **avant chaque
ship**, trace consignée dans la revue ; commande unique `pnpm test:golden-path`
avec délai par étape.

## Pièges & contraintes

- **Les deux régimes ne doivent jamais se mélanger** — la note de la story le dit
  et `AGENTS.md` l'impose. C'est « la source d'échecs intermittents la plus
  classique sur ce type de harnais ».
- **Le seuil de 30 minutes reste une recette humaine.** Le harnais fournit la
  mesure, il ne juge pas. Un test qui échouerait à 31 minutes transformerait une
  promesse commerciale en régression de CI, sur une machine dont on ne contrôle
  pas la charge.
- **Le critère 8 demande un délai par étape**, ce qui est autre chose : un
  parcours bloqué doit échouer en nommant l'étape, pas expirer globalement au
  bout de deux minutes (`playwright.config.ts:135`).
- **Une base vierge par exécution** entre en tension avec les quinze specs
  existantes, qui supposent la base du poste et un préchauffage partagé.
- **Le scénario touche presque tous les modules** : `auth`, `organizations`,
  `billing`, `i18n`, `marketing`. Une variante coupée d'un module rendrait le
  parcours non représentatif ; la configuration livrée fait foi.
- **Aucun secret dans un journal.** Les durées se journalisent, les clés non.

## Questions ouvertes

- **Que devient la trace du régime hors CI ?** Le critère 7 dit « consignée dans
  la revue de la story ». Cela vaut-il pour **chaque** story ultérieure — donc
  une modification du gabarit de revue — ou seulement pour celle-ci ?
- **Où vivent les enregistrements ?** Un événement Stripe enregistré contient des
  identifiants de client et de session réels d'un compte de test. Les committer
  demande de savoir ce qu'ils exposent.
- **Le parcours doré entre-t-il dans `pnpm test:e2e` ?** S'il y entre, chaque
  story paie son coût ; s'il n'y entre pas, il ne protège plus « à chaque story »
  comme le veut l'intention de la story.
- **La variante guest checkout** demande une adresse email par exécution ; la
  base vierge du critère 2 la fournit, mais le mode local fabrique
  `…@guest.local` — le régime réel, lui, exigera une vraie adresse.

## Complexité réelle

`docs/stories.md` annonce **3**. Après lecture : **4**.

Le scénario lui-même est du travail de harnais, bien outillé par ce qui existe.
Ce qui pèse est ailleurs : le critère 6 demande un mécanisme d'enregistrement qui
**n'existe pas**, le critère 4 demande une mesure honnête d'une phase déjà
consommée par l'environnement où elle s'exécute, et le critère 7 institue une
obligation **avant chaque ship** — donc une modification du processus, pas
seulement du code.

Pas de découpe proposée : les huit critères décrivent un seul harnais, et livrer
le scénario sans son régime enregistré donnerait une fausse assurance — le pire
résultat possible pour un test qui porte le critère de succès n°1.
