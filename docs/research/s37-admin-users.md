# Research — Story s37-admin-users

> Vérifiée contre `dev` au commit `4aba8c5`, en lecture seule. Worktree **nu** (9,1 Mo, sans dépendances installées), aucun conteneur — proposition P18 du retour d'expérience, appliquée ici pour la première fois.

## Les cinq faits structurants

1. **La prémisse de la story est fragilisée par le précédent du dépôt.** La note dit que « le plugin `admin` de Better Auth fournit liste, recherche, pagination, bannissement, réinitialisation, sessions et impersonation », donc que « le travail réel est l'interface ». Or les plugins réellement configurés (`better-auth-service.ts`, bloc `plugins:`) sont **`magicLink`, `passkey`, `withTwoFactorOnEverySignIn`** — et **s15 n'a pas adopté le plugin `organization`** : `packages/modules/organizations/src/schema.ts:16` cite le fichier du plugin **en référence de forme**, pas en dépendance. Le dépôt a donc déjà tranché une fois dans l'autre sens, pour la feature la plus proche.
2. **Rien du modèle n'existe.** `packages/modules/auth/src/schema.ts` ne porte **aucun** champ `banned`, `ban_*`, `impersonat*` ni `role`. Aucun module `admin` dans `packages/modules/` (onze modules, aucun ne s'en approche).
3. **Les rôles existants ne sont pas ceux dont la story parle.** `owner` / `admin` / `member` vivent dans **organizations** et sont scopés à une organisation (`domain/invitation.ts:291-295`). Le superadmin de la story est un rôle **de plateforme** : un concept neuf, pas une extension.
4. **Le point dur est un refus qui doit survivre à la coupure du module.** Critère : « un compte banni ne peut plus se connecter et ses sessions sont révoquées ». Le bannissement appartiendrait au module `admin` ; la connexion appartient à `auth`, qui est du **socle**. Or critère 14 : « module non activé : aucune route de back-office, aucun rôle de superadmin ». Il faut donc que le chemin de connexion consulte quelque chose qui **peut ne pas être là**, sans condition écrite en dur sur un module — le motif `EMPTY_MARKETING_SITE` de s10 est le précédent le plus proche.
5. **Trois stories d'affilée butent sur la même absence.** Le plan de site pour s29, le point d'émission unique pour s32, le refus à la connexion pour s37 : chaque fois, un module optionnel doit se greffer sur un chemin du socle, et le contrat de module (quatorze clés) n'a pas de fente pour ça. Ce n'est plus une coïncidence, c'est un signal d'architecture — et si la réponse est une quinzième clé, autant rouvrir les onze modules **une fois** plutôt que trois.

## Target story

Quatorze critères. Désignation du premier superadmin (variable d'environnement ou seed, testée depuis une base vierge) · promotion et révocation, le dernier ne pouvant se révoquer · aucun superadmin configuré → back-office en 404 et avertissement au démarrage nommant la variable · liste des utilisateurs avec recherche et pagination, 404 pour un non-superadmin · détail (organisations, droits, sessions) · bannir / débannir avec révocation des sessions · révoquer une session, déclencher une réinitialisation · impersonation avec bandeau permanent et sortie · pas d'impersonation d'un superadmin · début et fin journalisés avec les deux identifiants · liste des organisations quand le module est activé, entrée disparue sinon · détail d'organisation (membres, rôles, offre, abonnement) · inscriptions publiques filtrables et exportables en CSV, **vue générique n'énumérant aucune source en dur** · module coupé : aucune route, aucun rôle, et les modules qui le requièrent ne peuvent pas être activés (validation de s03).

Dépendances déclarées : `s17-roles-permissions`, `s21-trials-and-gating`, `s11-public-forms` — **les trois sont fusionnées**.

## Points d'ancrage

- `packages/modules/auth/src/infrastructure/better-auth-service.ts`, bloc `plugins:` — le point où un plugin `admin` s'ajouterait, si on décidait de l'adopter.
- `packages/modules/auth/src/schema.ts` — là où un champ de bannissement atterrirait, avec la contrainte de l'ADR 018 (clé étrangère vers un autre module seulement s'il est un `requires` déclaré).
- `packages/modules/organizations/src/domain/invitation.ts` — le motif « le dernier propriétaire ne peut pas se retirer », qui est exactement la forme du critère « le dernier superadmin ne peut pas se révoquer ».
- `packages/core/src/registry.ts` — l'agrégation de navigation, qui tient déjà la moitié « l'entrée disparaît » des critères 11 et 14.
- `docs/security.md` §3 — 404 plutôt que 403, ce que quatre critères invoquent.

## Pièges & contraintes

- **L'impersonation est une élévation de privilège.** Le socle de sécurité impose la rotation de l'identifiant de session à **chaque** élévation, et la révocation côté serveur. Deux critères en dépendent (ouverture et sortie d'impersonation) et aucun ne le dit.
- **La journalisation ne doit pas fuiter.** « Le début et la fin émettent une entrée avec l'identifiant du superadmin et celui de la cible » — des identifiants, jamais des adresses, jamais un jeton (`docs/security.md`, secrets).
- **La vue des inscriptions publiques doit être générique.** Le critère l'écrit ; c'est le même piège que le balayage vide de s26 — une vue qui énumère les sources en dur serait verte et fausse au premier formulaire ajouté.
- **Le CSV est une frontière.** Une injection de formule (`=`, `+`, `-`, `@` en tête de cellule) est le risque classique d'un export ouvert dans un tableur ; rien dans le dépôt ne le traite aujourd'hui.
- **Le module est requis par s42, s43 et s44.** Ce qu'on décide du rôle superadmin engage trois stories en aval.

## Questions ouvertes

- **Adopter le plugin `admin` de Better Auth, ou faire comme s15 ?** C'est la décision principale, et le précédent du dépôt penche contre le plugin. À trancher au plan, avec ADR — les deux options ont des conséquences opposées sur la quantité de code et sur la maîtrise du schéma.
- **Où vit le rôle superadmin, et comment `auth` refuse-t-il un compte banni sans dépendre d'un module optionnel ?** Question ouverte n°1 du fait 4. Le motif de la valeur vide (`EMPTY_MARKETING_SITE`) est la piste, pas la réponse.
- **La désignation par variable d'environnement se fait-elle sur une adresse ou un identifiant ?** Une adresse est lisible mais change ; un identifiant est stable mais illisible dans un `.env`. Non tranché.
- **« Ses droits d'accès » au critère 5 — lesquels ?** Le dépôt a des rôles d'organisation et des habilitations de facturation (s21). Le terme n'est pas défini.
- **Combien de superadmins la validation de démarrage exige-t-elle ?** Le critère 3 parle d'un avertissement, pas d'un refus : à confirmer que c'est bien voulu, puisque le reste du dépôt refuse au démarrage en nommant la variable.

## Complexité réelle

Notée **3** dans `docs/stories.md`. **Ma note : 5.**

Quatorze critères, trois tranches d'interface distinctes (utilisateurs, organisations, inscriptions), un modèle entièrement neuf, une élévation de privilège à sécuriser, un export à assainir, et une décision d'architecture dont trois stories en aval dépendent. La note de 3 repose sur « le plugin fait le travail » — et le fait 1 montre que le dépôt n'a jamais suivi ce raisonnement pour la feature voisine.

## Proposition de découpe — **requise** (verdict 5)

- **s37a — le rôle et le refus.** Désignation du premier superadmin, promotion et révocation avec le garde-fou du dernier, 404 sans superadmin, bannissement et révocation de sessions, et le refus à la connexion qui survit à la coupure du module. Close seule : la plateforme a des administrateurs et peut exclure un compte. C'est la tranche qui porte **toute** la décision d'architecture.
- **s37b — le back-office.** Liste et détail des utilisateurs, liste et détail des organisations, impersonation avec son bandeau et sa journalisation. Close seule : un administrateur assiste un client.
- **s37c — les inscriptions publiques.** Consultation générique, filtres, export CSV assaini. Close seule, et c'est la tranche la plus détachable : elle ne partage avec les deux autres que la garde de superadmin.

La ligne de coupe suit le risque, pas la taille : s37a contient la sécurité et l'architecture, s37b l'interface, s37c une fonctionnalité indépendante. s42, s43 et s44 ne dépendent que de **s37a**.
