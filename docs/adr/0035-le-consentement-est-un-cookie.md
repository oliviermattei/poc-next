# ADR 035 — Le consentement aux cookies vit dans un cookie, jamais en base

- Status: accepted
- Date: 2026-09-02
- Scope: story s36-cookie-consent

## Context

`docs/architecture.md` attribue une entité `consent` au module `gdpr` (s34/s35),
au même rang que `deletion_request` et `export_request`. Le contrat de module
(ADR 007) offre par ailleurs tout ce qu'il faut pour persister : `schema`,
`migrations`, `dataCategories`, `retention`, `purge`, `export`.

Trois faits s'y opposent, et ils viennent des critères de s36 :

1. **Le choix ne dépend pas d'un compte.** Un visiteur anonyme a exactement le
   même droit qu'un utilisateur connecté à accepter, refuser et revenir sur son
   choix. C'est aussi la seule forme utile : un visiteur qui n'a pas de compte
   est précisément celui qu'un outil d'analyse observerait sans qu'il le sache.
2. **Le choix doit survivre au rechargement**, y compris avant toute session.
3. **Le module est socle et sans état off propre** : il est inerte quand aucun
   script non essentiel n'est déclaré, ce qui est l'état livré du boilerplate.

## Decision

Le module `consent` **ne persiste rien**. `schema: {}`, `migrations: null`,
`dataCategories: []`, `retention: {}`, `purge` et `export` à vide. Le choix du
visiteur est écrit dans un cookie strictement nécessaire — `app_consent`,
`HttpOnly`, `Secure`, `SameSite=Lax`, six mois — posé **par le serveur** en
réponse à une soumission de formulaire.

## Considered options

- **Une table `consent`, une ligne par sujet** — rejetée : identifier un
  visiteur anonyme de façon persistante pour y rattacher son refus revient à le
  pister afin d'enregistrer qu'il refuse d'être pisté. Le remède serait la
  maladie.
- **Une ligne par compte, cookie pour les anonymes** — rejetée : deux sources de
  vérité pour la même décision, donc une divergence garantie (que vaut le cookie
  d'un poste partagé après connexion ?) et un chemin de code par cas. Le
  critère « le choix ne dépend pas d'un compte » deviendrait invérifiable.
- **Un cookie lisible par le JavaScript de page** — rejetée : `docs/security.md`
  §1 exige `HttpOnly` sans exception, et `apps/web/AGENTS.md` en fait une
  décision de story. Surtout, un cookie de consentement modifiable par un script
  de page serait modifiable par **le script même qu'on cherche à contenir**.
- **Un état React côté client** — rejetée : refuser des cookies ne peut pas
  dépendre du script qu'on refuse. La bannière est un `<form method="post">`
  natif, et c'est ce qui la rend utilisable sans JavaScript.

## Consequences

**Ce qui devient facile.** Aucune migration, aucun ordre de purge, aucune
question de propriétaire de donnée. Le module est réellement inerte quand rien
n'est déclaré. Le choix s'applique **au rendu du serveur** : les balises des
scripts non essentiels n'existent pas tant que leur catégorie n'est pas
accordée, ce qui est plus fort qu'un script chargé puis bridé.

**Ce qui devient plus difficile.** Le choix est lié à l'appareil et au
navigateur : un même compte redemande son consentement sur un second appareil.
C'est le comportement attendu — un consentement est donné depuis un terminal,
et c'est ce terminal qui dépose les cookies.

**Ce qu'il faut surveiller.**

- `docs/architecture.md` reste faux sur ce point tant que s34/s35 ne l'a pas
  corrigé : la table `consent` qu'il annonce n'existe pas et n'a pas à exister.
  Le signaler plutôt que le taire est le seul geste possible ici, l'architecture
  n'étant pas modifiable depuis une story.

  **Avertissement à l'agent de s34/s35, à lire avant d'écrire une migration.**
  La ligne `docs/architecture.md:119` attribue au module `gdpr` les entités
  `deletion_request`, `export_request` et **`consent`**. Cette troisième entité
  est antérieure à cet ADR, et elle est à trancher **avant** d'écrire quoi que
  ce soit :

  - s'il s'agit du **consentement aux cookies non essentiels**, la table est
    **interdite** par le présent ADR : ce consentement est un cookie sur
    l'appareil du visiteur, et le persister demanderait d'attribuer un
    identifiant durable à un anonyme — le pister pour noter son refus d'être
    pisté. La ligne est alors périmée, et c'est la ligne qu'il faut corriger,
    pas le code ;
  - s'il s'agit d'**autre chose** — un consentement rattaché à un compte
    identifié, par exemple l'acceptation datée des CGU ou d'un traitement
    déclaré au RGPD —, la table est légitime, mais elle ne doit ni porter le nom
    nu `consent`, ni être lue comme la trace du choix de cookies. Le nom doit
    dire lequel des deux elle est.

  Dans les deux cas, l'arbitrage se prend **en cadrage**, avec le droit de
  réécrire `docs/architecture.md` — droit qu'une story n'a pas. Un agent de s34
  qui créerait la table sur la seule foi de cette ligne réintroduirait ce que
  cet ADR a rejeté, et il le ferait de bonne foi.
- Un besoin de **preuve de consentement** — journal horodaté opposable — serait
  une décision de produit, pas un détail d'implémentation : il demanderait un
  ADR qui supersède celui-ci, et il rouvrirait la question de l'identifiant
  d'un visiteur anonyme.
- La durée de six mois est écrite dans le module (`CONSENT_COOKIE_MAX_AGE`).
  L'allonger revient à opposer au visiteur une décision qu'il ne se rappelle pas
  avoir prise.
