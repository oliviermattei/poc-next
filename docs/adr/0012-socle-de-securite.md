# ADR 012 — Un socle de sécurité s'applique à chaque changement

- Status: accepted
- Date: 2026-08-30

Le dépôt se veut prêt pour la production, durci contre l'abus, le détournement de compte et l'automatisation hostile. Une partie de la sécurité est une fonctionnalité (la limitation de débit), mais l'essentiel est transverse — en-têtes et CSP, sessions, autorisation, entrées et sorties, secrets, dépendances, journalisation — et se perd changement après changement si rien ne l'impose. Ces contrôles sont donc décrits en un seul endroit, `docs/security.md`, s'appliquent à tout changement et pas seulement à un changement de sécurité, et sont vérifiés par des tests. Un manquement bloque la fusion, au même rang qu'une régression fonctionnelle (`CODING_STANDARDS.md`, Security baseline).

## Considered options

- Un chantier « sécurité » unique en fin de parcours — rejeté : il découvrirait les mêmes trous dans chaque package. Ce qui est transverse se pose au contrat, comme `purge`, `export` et `retention`.
- S'en remettre aux défauts du framework — rejeté : Next ne fournit ni CSP, ni limitation de débit, ni durcissement de session.
- Un audit externe — retenu comme complément, pas comme substitut : un audit valide un état, il ne maintient pas une discipline.

## Consequences

- Un coût sur chaque changement, et des conflits avec des pratiques répandues (scripts en ligne contre une CSP stricte) : ils se résolvent en durcissant, pas en assouplissant.
- `docs/security.md` reste une liste de contrôles vérifiables, pas un cours ; un socle trop verbeux ne serait pas lu.
