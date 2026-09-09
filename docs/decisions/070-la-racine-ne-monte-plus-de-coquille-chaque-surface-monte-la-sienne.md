# ADR 070 — La racine ne monte plus de coquille : chaque surface monte la sienne

- Status: accepted
- Date: 2026-09-10
- Scope: story s60-back-office-autonome

## Context

Le back-office (`/admin/*`) était servi dans le châssis du produit :
`app/layout.tsx` enveloppait **tous** les écrans dans `AppShell`, sidebar des
modules activés, bandeau de consentement, compteur de notifications compris. Le
superadmin administrait donc la plateforme depuis l'intérieur de l'application
qu'il administre, avec deux navigations concurrentes à l'écran, et un traceur
d'audience chargé sur une surface que seul l'exploitant regarde.

Next ne permet pas à une layout enfant de défaire ce que sa racine a monté : tant
que la coquille est en haut, toute surface qui n'en veut pas doit la **masquer**,
c'est-à-dire dépendre d'une condition que personne ne mesure.

Deux forces s'ajoutaient à celle-là. D'abord une contrainte de sécurité : un
compte qui n'administre pas reçoit **404** sur un écran d'administration
(`docs/security.md` §3) ; si le châssis du back-office entoure ce refus, la
surface se laisse deviner par sa propre page d'erreur. Ensuite une contrainte de
rendu : le back-office n'hydrate rien, et sa coquille ne doit pas y introduire le
premier composant client.

## Decision

**La racine ne monte aucune coquille. Chaque groupe de routes monte la sienne.**

- `app/(app)/layout.tsx` monte `AppShell` — le produit ;
- `app/(admin)/` **ne pose aucune layout** : le châssis du back-office est rendu
  par l'**écran**, à l'intérieur de ce que la garde a laissé passer ;
- `app/layout.tsx` ne garde que le document, les polices, le thème et le
  catalogue.

Les groupes de routes n'existant pas dans l'URL, aucune adresse ne change.

## Considered options

- **Une condition dans la coquille** (« si le chemin commence par `/admin`, ne
  rends pas la navigation ») — rejetée : la racine apprend à connaître le
  back-office, la coquille devient conditionnelle, et rien ne rougit le jour où
  la condition cesse de correspondre. C'est exactement le mode d'échec que
  l'`AGENTS.md` racine nomme : une règle qu'aucune commande ne vérifie.
- **Une layout de groupe pour `(admin)`** — rejetée après mesure : une layout de
  groupe enveloppe aussi les refus de ses routes. Le 404 d'un compte qui
  n'administre pas aurait porté le châssis du back-office.
- **Une application séparée** (`apps/console`, domaine propre) — rejetée : un
  second déploiement, un second domaine, une session à partager entre deux
  origines, et l'emprunt de session — qui repose le cookie du produit — à
  reconstruire. Le besoin est un autre châssis, pas un autre serveur.
- **Le statu quo** — rejeté : c'est le défaut décrit ci-dessus.

## Consequences

**Plus facile** : donner à une surface son propre châssis (une troisième
n'aurait qu'à ajouter son groupe) ; retirer du back-office ce qui appartient au
produit — consentement, scripts tiers, compteur de notifications — sans condition
écrite nulle part.

**Plus difficile** : la page introuvable. Elle a désormais **deux montages**, et
c'est une mesure, pas une prévision : Next rend `notFound()` à l'intérieur des
layouts du segment où il a été levé, si bien qu'un fichier racine qui monte le
châssis en produisait **deux** pour un refus levé dans `(app)` —
`pnpm test:socle` l'a vu sur `/organizations`, module coupé, en rendant deux
bandeaux d'emprunt de session. `app/(app)/not-found.tsx` ne monte donc rien, et
`app/not-found.tsx` monte le châssis pour les URL qui n'appartiennent à aucun
groupe.

**À surveiller** : une layout posée sous `(admin)` ramènerait le défaut de
sécurité écarté ici. Un cas de `tests/admin.test.ts` la refuse, un autre refuse
tout import d'`AppShell` sous ce groupe, et `e2e/admin.spec.ts` mesure le rendu —
les deux mutations ont été jouées et rougissent.

**Ce qui n'est pas garanti** : les mesures de fichier ne lisent pas le JSX. Rien
n'empêche un écran d'administration de composer un jour la navigation du produit
à la main ; c'est le parcours navigateur qui le verrait, pas le test de fichier.
