# ADR 035 — Le consentement aux cookies vit dans un cookie, jamais en base

- Status: accepted
- Date: 2026-09-02

Un visiteur anonyme a le même droit qu'un utilisateur connecté d'accepter, refuser et revenir sur son choix, et ce choix doit survivre au rechargement avant toute session. C'est même lui qu'un outil d'analyse observerait sans qu'il le sache.

Le module `consent` **ne persiste rien** : schéma, migrations, catégories de données, rétention, purge et export sont vides. Le choix est écrit dans un cookie strictement nécessaire, `app_consent` — `HttpOnly`, `Secure`, `SameSite=Lax`, six mois (`CONSENT_COOKIE_MAX_AGE`) — posé par le serveur en réponse à un `<form method="post">` natif. Le choix s'applique au rendu serveur : les balises des scripts non essentiels n'existent pas tant que leur catégorie n'est pas accordée.

## Considered options

- **Une table de consentement, une ligne par visiteur** — rejeté : identifier durablement un anonyme pour y noter son refus revient à le pister pour enregistrer qu'il refuse d'être pisté.
- **Une ligne par compte, un cookie pour les anonymes** — rejeté : deux sources de vérité pour une même décision, et une divergence garantie sur un poste partagé.
- **Un cookie lisible par le JavaScript de page, ou un état React** — rejeté : `docs/security.md` exige `HttpOnly`, et un consentement modifiable par un script de page le serait par le script même qu'on cherche à contenir.

## Consequences

Le choix est lié à l'appareil : un même compte redemande son consentement sur un second appareil.

Un consentement rattaché à un compte identifié (acceptation datée des CGU, par exemple) serait légitime, mais ce ne serait pas la trace du choix de cookies. Une preuve de consentement opposable — journal horodaté — serait une décision de produit qui remplacerait cette ADR et rouvrirait la question de l'identifiant d'un anonyme.
