# ADR 023 — La liaison d'un compte OAuth exige une double preuve d'adresse

- Status: accepted
- Date: 2026-08-31

Quand une connexion par fournisseur externe présente une adresse qui correspond déjà à un compte local, lier sans preuve ouvre le *pre-hijacking* : un attaquant inscrit l'adresse de la victime avec un mot de passe sans la vérifier, la victime se connecte ensuite par Google, la bibliothèque rapproche les deux comptes, et l'attaquant garde un accès par son mot de passe. À l'inverse, un fournisseur qui n'atteste pas l'adresse ne prouve rien (GitHub expose des adresses non vérifiées).

**Une identité de fournisseur ne rejoint un compte local que si l'adresse est attestée deux fois : par le fournisseur et par le compte local.** Le crochet `user.validateUserInfo` refuse toute identité dont l'adresse n'est pas attestée, sur les trois actions (création, liaison, retour) ; la règle vit dans `oauthProvisioningRefusal` (`domain/oauth.ts` du module `auth`). Le refus à la création compte : sans lui, la bibliothèque crée la ligne `auth_user` puis refuse la session, et l'adresse d'un tiers reste squattée. La configuration écrit explicitement `requireLocalEmailVerified: true`, `trustedProviders: []` et `allowDifferentEmails: false` — un défaut de bibliothèque qu'aucun test ne tient change à la prochaine montée de version.

Le refus ne dit pas pourquoi : la route ne laisse sortir que « autorisation refusée » ou « connexion impossible ». Distinguer « un compte existe à cette adresse » serait une énumération de comptes depuis une page publique (`docs/security.md`).

## Considered options

- **Faire confiance à Google et GitHub par `trustedProviders`** — rejeté : la confiance porterait sur le fournisseur, pas sur l'attestation, et accepterait aussi leurs adresses non vérifiées.
- **Demander à l'utilisateur « un compte existe, voulez-vous le lier ? »** — rejeté : la question est un oracle d'énumération posé à un visiteur non authentifié. La liaison explicite se fait depuis les paramètres du compte, authentifiée (`/link-social`, non monté aujourd'hui).
- **Créer un second compte sur la même adresse** — rejeté : l'adresse est unique, et deux comptes indiscernables rendraient « quel est mon compte ? » sans réponse.

## Consequences

Un utilisateur dont le compte mot de passe n'est pas vérifié se voit refuser la connexion par fournisseur, avec un message générique ; il en sort en vérifiant son adresse ou en réinitialisant son mot de passe.

`trustedProviders: []` est un filet indépendant du crochet, évalué avant lui par la bibliothèque : il faut neutraliser les deux pour qu'un test rougisse. `allowDifferentEmails: false` n'est lu que par le parcours de liaison explicite, injoignable tant que `/link-social` n'est pas déclaré : le ticket qui le déclarera devra couvrir cette ligne par un test, pas la supposer tenue.
