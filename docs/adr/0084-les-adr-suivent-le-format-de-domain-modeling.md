# ADR 084 — Les ADR suivent le format de `/domain-modeling` et ne portent que des décisions en vigueur

- Status: accepted
- Date: 2026-10-13
- Supersedes: la clause de l'ADR 082 qui déplaçait les ADR « sans changer leur contenu », et l'obligation du gabarit MADR complet.

Les skills (`/tdd`, `/to-tickets`, `/implement`) chargent les ADR de la zone touchée et les tiennent pour des règles ; or les ADR écrites sous killer-saas mêlaient leur décision à l'historique de la méthode (identifiants de story, constats de revue, plans, critères d'acceptation, pointeurs `fichier:ligne`) et à des interdits de procédure, gardaient des décisions remplacées sous le statut `accepted`, et comptaient des choix réversibles qui n'en étaient pas. Une ADR suit désormais le format de `/domain-modeling` : un titre `# ADR NNN — …` et quelques phrases (contexte, décision, raison), les sections Options et Conséquences seulement quand elles apprennent quelque chose ; elle ne s'écrit que pour une décision difficile à défaire, surprenante sans contexte et issue d'un vrai arbitrage.

Règles qui en découlent :

- **Une ADR dit la décision en vigueur.** Une décision changée s'écrit dans une nouvelle ADR ; l'ancienne passe à `superseded by ADR NNN` dans le même commit, ou, si seule une clause change, l'ancienne est réécrite sur ce point et renvoie à la nouvelle.
- **Une ADR entièrement remplacée, ou qui n'est pas une décision, se supprime** ; sa règle va là où elle vit (`CODING_STANDARDS.md`, un `AGENTS.md`, un commentaire de code, `docs/design-system.md`), et chaque citation « ADR NNN » est réécrite dans le même commit. Un numéro supprimé n'est jamais réattribué. Ce nettoyage a supprimé 005, 009, 011, 015, 017, 019, 041, 052, 055, 056, 067, 077 et 081.
- **L'historique ne vit pas dans les ADR** : il se lit dans git et dans les PR. Retirer d'une ADR stories, revues, plans et pointeurs n'est pas changer sa décision.
- **Une règle que la revue doit faire respecter vit dans `CODING_STANDARDS.md`** (lu par `/code-review`) ; l'ADR n'en garde que le pourquoi.
