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

- **Aucune table ne persiste le choix de cookies.** Le persister demanderait
  d'attribuer un identifiant durable à un anonyme — le pister pour noter son
  refus d'être pisté. Un consentement rattaché à un compte identifié
  (acceptation datée des CGU, traitement déclaré au RGPD) serait légitime, mais
  sa table ne porterait pas le nom nu `consent` et ne serait jamais lue comme la
  trace du choix de cookies.
- Un besoin de **preuve de consentement** — journal horodaté opposable — serait
  une décision de produit, pas un détail d'implémentation : il demanderait un
  ADR qui supersède celui-ci, et il rouvrirait la question de l'identifiant
  d'un visiteur anonyme.
- La durée de six mois est écrite dans le module (`CONSENT_COOKIE_MAX_AGE`).
  L'allonger revient à opposer au visiteur une décision qu'il ne se rappelle pas
  avoir prise.
