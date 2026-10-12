# ADR 012 — Socle de sécurité imposé à chaque story

- Status: accepted
- Date: 2026-08-30
- Scope: framing

## Context
Le PRD fixe comme angle n°4 « conformité et robustesse par défaut » et constate qu'aucune des quatre cibles ne livre de rate limiting, de captcha, d'export de données ni de bannière de consentement. Le propriétaire demande davantage : un boilerplate **production grade**, durci contre l'abus, le détournement de compte et l'automatisation hostile.

Traiter la sécurité comme une story (s28) suffit pour la limitation de débit, mais pas pour ce qui est transverse : en-têtes HTTP, gestion des sessions, secrets, dépendances, journalisation. Ces contrôles ne s'ajoutent pas après coup — ils se perdent story par story si rien ne les impose.

## Decision
Un **socle de sécurité** s'applique à toute story, au même titre que la règle de dépendance des couches. Il est décrit en un seul endroit, `docs/security.md`, et il est **vérifié par des tests et par la revue**, jamais par la bonne volonté.

Ce socle couvre sept domaines : en-têtes et politique de sécurité du contenu, sessions et authentification, autorisation, entrées et sorties, secrets et configuration, dépendances et chaîne d'approvisionnement, journalisation et détection d'abus.

Toute story qui expose une route, un formulaire ou une donnée doit démontrer sa conformité. Un manquement au socle est un finding **critical** en revue, au même rang qu'une régression fonctionnelle.

## Considered options
- **Une story « sécurité » unique en fin de parcours** — rejeté : c'est la garantie d'un audit qui découvre quarante trous à corriger dans quarante packages. Le PRD applique déjà ce raisonnement à `purge`, `export` et `retention` : ce qui est transverse se pose au contrat, pas à la fin.
- **S'en remettre aux défauts du framework** — rejeté : Next protège contre certaines classes d'attaques mais ne fournit ni politique de sécurité du contenu, ni limitation de débit, ni durcissement de session, ni détection d'anomalie. Les défauts d'un framework ne sont pas une posture de sécurité.
- **Un audit externe avant commercialisation** — rejeté comme substitut, retenu comme complément : un audit valide un état, il ne maintient pas une discipline.

## Consequences
Facilité : chaque story hérite d'une posture au lieu de la réinventer ; la revue a un référentiel opposable plutôt qu'un avis.
Difficulté : coût récurrent sur chaque story, et certains contrôles (politique de sécurité du contenu stricte) entrent en conflit avec des pratiques répandues comme les scripts en ligne. Ces conflits se résolvent en durcissant, pas en assouplissant.
À surveiller : un socle trop verbeux ne sera pas lu. `docs/security.md` doit rester une liste de contrôles vérifiables, pas un cours de sécurité.
