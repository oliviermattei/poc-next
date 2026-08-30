---
validated: yes
---
# Plan — Story s06-transactional-emails

Branch: `dev`. Research: `docs/research/s06-transactional-emails.md`. Validation déléguée.

## Target story

Le moteur d'emails transactionnels, premier port et premier adapter du dépôt. Sept critères repris de `docs/stories.md`.

Socles couverts : **`docs/security.md` §5** (aucun secret dans un journal, filtrage testé) ; **`docs/reliability.md` §2** (le provider injoignable dégrade, ne casse pas) et **§3** (délai d'attente explicite, reprises sur erreurs transitoires seulement).

## Tasks (ordered)

1. [ ] **`packages/ports`** — le package, son `AGENTS.md`, et l'interface `Mailer` : envoi d'un email (destinataire, sujet, template, données), rien d'autre. C'est le **gabarit de cinq autres ports** (storage, paiement, jobs, analytique, monitoring) : la forme retenue ici sera copiée.
2. [ ] **Doublure d'enregistrement** — capture les envois, expose destinataire, template et données pour assertion. Exportée pour les suites. Injectée, **jamais** choisie par `NODE_ENV`.
3. [ ] **`packages/adapters/resend`** — l'unique implémentation livrée, avec `AGENTS.md`. Délai d'attente explicite, reprises en recul exponentiel avec dispersion sur erreurs transitoires uniquement.
4. [ ] **Capture locale** — sans clé d'API, l'email est écrit localement et consultable. Dossier ignoré par git.
5. [ ] **Rendu React Email** — un template de démonstration, rendu avec ses données, couvert par un test de rendu.
6. [ ] **Dégradation et journalisation** — un échec du provider est journalisé et remonté à l'appelant **sans faire tomber la requête**. Aucun secret ni contenu d'email dans le journal ; le filtrage est **testé par mutation**, pas seulement configuré.
7. [ ] **Documentation de délivrabilité** — SPF, DKIM, DMARC, avec un test vérifiant la présence de la section et des trois enregistrements.

## Run interdicts

- **Aucun second adapter** : ni SMTP, ni SendGrid, ni Nodemailer. Ils sont au cimetière (ADR 008). Les doublures sont des outils de test et doivent être nommées comme telles dans leur `AGENTS.md`.
- **Aucun envoi réel depuis un test de CI.**
- **Aucun mailer choisi par `NODE_ENV`** — injection uniquement.
- **`domain` ne connaît pas le mailer** : port dans `application`, implémentation dans `infrastructure`. Le lint le vérifie.
- **Aucun secret, aucune adresse, aucun contenu d'email dans un journal.**
- Ne pas toucher au contrat de module (s03), à la génération de barils (s04), au CLI (s05), ni à `config/features.ts`. `docs/` intouché hors cases de ce plan. Remote git intouché.

## The point everything turns on

**La forme du port, parce qu'elle sera copiée cinq fois.**

`packages/ports` et `packages/adapters` prennent corps ici pour la première fois. Storage (s18), paiement (s19), jobs (s33), analytique et monitoring (s39) suivront le gabarit posé aujourd'hui. Trois endroits où se tromper coûte cinq fois :

- **La granularité.** Un port par capacité, ou un package par port ? Comparer avec ce que l'architecture annonce (`packages/ports` au singulier, `packages/adapters` contenant `resend`, `s3`, `stripe`…) et avec la règle de dépendance des couches.
- **La forme de l'erreur.** Un port qui lève, ou qui rend un résultat ? Le critère 6 exige « remonté à l'appelant **sans faire tomber la requête** » — comparer les deux formes contre ce critère avant de choisir.
- **La frontière du test.** Où s'arrête la doublure, où commence l'adapter ? s01 a montré qu'un test peut prétendre vérifier un envoi réel tout en interrogeant une doublure. Le régime doit être lisible dans le nom du test.

## Test strategy

Unitaire : rendu du template, filtrage des données sensibles (**par mutation**), politique de reprise (transitoire contre définitif), présence de la documentation de délivrabilité. Intégration CI : doublure d'enregistrement, assertion sur destinataire, template et données. Hors CI, sur commande explicite : envoi réel contre la clé de test Resend. Dégradation : provider injoignable, la requête aboutit avec une erreur explicite.

## Definition of Done

Les sept critères satisfaits, chacun couvert par un test ou une recette manuelle tracée. `typecheck`, `lint`, `test`, `test:e2e`, `build`, `run audit` verts dans les trois états de configuration. §5 de `docs/security.md` et §2-§3 de `docs/reliability.md` couvertes. Aucun interdit violé. Un commit sur `dev`. Revue en contexte frais passée.
