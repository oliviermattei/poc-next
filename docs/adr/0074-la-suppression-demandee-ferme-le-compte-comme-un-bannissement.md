# ADR 074 — Une suppression demandée ferme le compte comme un bannissement

- Status: accepted
- Date: 2026-09-28

La suppression d'un compte est une tâche de fond : entre la demande (202) et le passage de la purge, la ligne `auth_user` vit, et une nouvelle connexion rouvrirait le compte dans une fenêtre non bornée. Le socle sait déjà fermer un compte sans l'effacer : le bannissement (ADR 058), gardé dans le crochet de création de session de la bibliothèque et dans l'écrivain unique de session (`insert … select … where banned = false`), tenu par une règle de lint. Une demande de suppression acceptée pose donc une colonne nullable `auth_user.deletion_requested_at`, et la connexion est refusée quand le compte est banni **ou** que sa suppression est demandée : un seul prédicat, consommé aux deux mêmes endroits, avec le même refus générique qu'un compte inconnu. La colonne n'est posée qu'après une mise en file réussie.

## Considered options

- **Réutiliser `banned`** — rejeté : un débannissement par un superadmin rouvrirait un compte dont l'utilisateur a demandé l'effacement, et le motif de bannissement mentirait sur la cause.
- **Supprimer la ligne tout de suite, purger le reste plus tard** — rejeté : la purge a besoin du compte (adresse de l'email de confirmation, organisations à libérer) et elle est idempotente par absence du compte.
- **Refuser dans chaque route de connexion** — rejeté : un chemin qui ne passe pas par le crochet de la bibliothèque y échapperait ; c'est pourquoi le bannissement vit dans l'écrivain de session.

## Consequences

La règle de lint de l'écrivain de session exige le nouveau prédicat, pas seulement `banned = false`. Il n'existe pas d'annulation d'une demande de suppression.
