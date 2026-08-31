---
validated: yes
---
# Plan — Story s07-signup-signin

Branch: `dev`. Research: `docs/research/s07-signup-signin.md`. Validation déléguée.

## Target story

L'authentification : inscription, connexion, vérification d'email, magic link, réinitialisation, sessions. Treize critères repris de `docs/stories.md`.

Socles couverts : **`docs/security.md` §2 en totalité** (sessions et authentification), §3 (autorisation, pour la résolution de session), §5 (aucun secret journalisé), §7 (événements de sécurité journalisés) ; **`docs/reliability.md` §2** (le mailer indisponible dégrade proprement).

## Tasks (ordered)

1. [x] **Module `auth`** — package, quatre couches, `AGENTS.md`. Socle non désactivable : pas de critère « module non activé », et il faut l'écrire dans son `AGENTS.md`.
2. [x] **Schéma et migrations** — les tables Better Auth intégrées au **schéma du module**, jamais à la racine, générées par le baril de s04. C'est le premier module qui persiste réellement : il doit aussi résoudre `enabledModuleSchemas = []`, sinon `db.query.<table>` reste indisponible (résidu documenté en s04).
3. [x] **Branchement du port `Mailer`** — les hooks d'envoi de Better Auth appellent le port de s06, jamais un client interne. Deux chemins d'envoi rendraient le §5 invérifiable.
4. [x] **Trois templates** — vérification, magic link, réinitialisation, déclarés au contrat avec **toutes** les locales du module.
5. [x] **Parcours** — inscription, vérification, connexion, magic link, mot de passe oublié, déconnexion, redirection puis retour à l'URL demandée.
6. [x] **Durcissement de session** (§2) — rotation de l'identifiant à chaque élévation de privilège ; cookie `HttpOnly`, `Secure`, `SameSite`, jamais lisible par le JavaScript client ; révocation effective **côté serveur** ; changement de mot de passe ou d'email révoquant les autres sessions.
7. [x] **Jetons à usage unique** — vérification, magic link, réinitialisation : durée de vie courte, consommation atomique, invalidation des jetons frères à l'usage.
8. [x] **Indistinguabilité** — message identique pour compte inconnu et mot de passe invalide, **et temps de réponse indistinguable**. Le second se prouve par une mesure, pas par une lecture.
9. [x] **Journalisation** — événements de sécurité avec leur acteur, sans jamais journaliser un jeton, un mot de passe ni un cookie. Filtrage **prouvé par mutation**.
10. [x] **`resolveSession`** — brancher le crochet que s03 attend, sans que `packages/core` dépende du module `auth`.

## Run interdicts

- **Ne pas laisser Better Auth envoyer un email directement** : le port `Mailer` de s06 est le seul chemin.
- **Ne pas mettre le schéma d'authentification à la racine** : il appartient au module, et s04 le génère.
- **Aucune énumération de comptes**, ni par message, ni par code de statut, ni par temps de réponse.
- **Aucun secret journalisé** : jeton, mot de passe, cookie de session.
- **`domain` ne connaît ni Better Auth ni Drizzle** — le lint le vérifie.
- **Ne pas implémenter OAuth, 2FA ni passkeys** : ce sont s12, s13 et s14. Les plugins peuvent être prévus, pas activés.
- **Ne pas toucher** au contrat de module (s03), à la génération de barils (s04), au CLI (s05), au port `Mailer` (s06), ni à `config/features.ts`. `docs/` intouché hors cases de ce plan.

## The point everything turns on

**La frontière entre Better Auth et le dépôt.**

Une bibliothèque d'authentification veut naturellement tout faire : son schéma, ses emails, ses routes, sa session. Chacune de ces quatre choses a déjà un propriétaire ici — le contrat de module pour le schéma, le port `Mailer` pour les emails, le registre pour les routes, `resolveSession` pour la session. Laisser la bibliothèque court-circuiter l'un des quatre crée un second chemin que les socles ne surveillent pas.

Trois endroits où le vérifier :
- **Les emails.** Comparer ce que Better Auth envoie réellement avec ce qui transite par le port : si un email part sans passer par `Mailer`, la doublure d'enregistrement ne le voit pas et le §5 est invérifiable.
- **Le schéma.** Comparer les tables réellement créées sur base vierge avec celles que le module déclare : une table créée hors du baril échappe à s04 et à la promesse de modularité.
- **La session.** Comparer le cookie effectivement posé (attributs compris) avec ce que le §2 exige, et vérifier que la rotation a bien lieu — Better Auth peut ne pas la fournir, auquel cas elle s'écrit.

## Test strategy

Unitaire : jetons à usage unique et invalidation des frères, politique de session, filtrage des journaux (**par mutation**). Intégration base réelle : parcours d'inscription, vérification, connexion, réinitialisation ; révocation des autres sessions ; tables créées conformes au module. Doublure d'enregistrement du port `Mailer` : les trois emails partent avec le bon destinataire, le bon template et la bonne locale. **Mesure** : temps de réponse compte inconnu contre mot de passe invalide, sur un nombre d'essais suffisant pour être significatif. End-to-end : parcours complet dans un navigateur, cookie inspecté, route protégée refusée puis accordée.

## Definition of Done

Les treize critères satisfaits, chacun couvert par un test ou une recette manuelle tracée. §2 de `docs/security.md` intégralement couverte. `typecheck`, `lint`, `test`, `test:e2e`, `build`, `run audit` verts dans les trois états de configuration. Aucun interdit violé. Un commit sur `dev`. Revue en contexte frais passée.
