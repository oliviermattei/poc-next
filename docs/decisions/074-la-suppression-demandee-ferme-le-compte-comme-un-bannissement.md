# ADR 074 — Une suppression demandée ferme le compte comme un bannissement

- Status: accepted
- Date: 2026-09-28
- Scope: story s67-suppression-en-attente

Prolonge l'ADR 058 (l'état « banni » appartient au socle) sans le réécrire.

## Context
La suppression d'un compte est une tâche de fond (s34) : entre la demande (202) et le passage de la purge, la ligne `auth_user` vit, et toute méthode de connexion rouvre le compte. s61 révoque déjà les sessions à la demande ; la revue de s61 a relevé qu'une **nouvelle** connexion reste possible dans cette fenêtre, non bornée sous Inngest. Le socle sait déjà fermer un compte sans l'effacer : le bannissement, gardé dans le crochet de création de session de la bibliothèque **et** dans l'écrivain unique de session (`insert … select … where banned = false`), tenu par une règle de lint.

## Decision
Une demande de suppression acceptée pose sur `auth_user` une colonne nullable `deletion_requested_at`. La connexion est refusée quand le compte est banni **ou** que sa suppression est demandée : **un seul prédicat**, consommé aux deux mêmes endroits que le bannissement, avec le même refus générique qu'un compte inconnu. La colonne est posée **après** une mise en file réussie ; une émission refusée ne pose rien.

## Considered options
- **Réutiliser `banned`** — rejetée : un débannissement par un superadmin rouvrirait un compte dont l'utilisateur a demandé l'effacement, et le motif de bannissement (texte libre) mentirait sur la cause.
- **Supprimer la ligne tout de suite et purger le reste plus tard** — rejetée : la purge a besoin du compte (adresse pour l'email de confirmation, organisations à libérer) et elle est idempotente **par absence** du compte ; effacer d'abord casserait les deux.
- **Refuser dans chaque route de connexion** — rejetée : c'est la raison pour laquelle le bannissement vit dans l'écrivain de session (s37b1, C1) — un chemin qui ne passe pas par le crochet de la bibliothèque y échapperait.

## Consequences
- La migration ajoute une colonne nullable : la version encore en ligne l'ignore (`docs/reliability.md`, « ajouter avant de lire »).
- La règle de lint de l'écrivain de session exige le nouveau prédicat, pas seulement `banned = false`.
- Aucune commande d'annulation d'une demande de suppression n'est introduite : ce serait une nouvelle fonctionnalité, hors périmètre.
