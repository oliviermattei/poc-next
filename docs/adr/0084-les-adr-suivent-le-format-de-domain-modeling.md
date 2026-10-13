# ADR 084 — Les ADR suivent le format de `/domain-modeling` et ne portent plus l'historique de l'ancienne méthode

- Status: accepted
- Date: 2026-10-13
- Supersedes: la clause de l'ADR 082 qui déplaçait les ADR « sans changer leur contenu », et l'obligation du gabarit MADR complet.

Les skills (`/tdd`, `/to-tickets`, `/implement`) chargent les ADR de la zone touchée et les tiennent pour des règles ; or les ADR écrites sous killer-saas mêlent leur décision à l'historique de la méthode (identifiants de story, constats de revue, plans, critères d'acceptation, pointeurs `fichier:ligne`) et à des interdits de procédure (« une story n'a pas le droit de… »), qui égarent l'agent ou lui font refuser un ticket légitime. Désormais une ADR suit le format de `/domain-modeling` : un titre `# ADR NNN — …` et quelques phrases (contexte, décision, raison), les sections Options et Conséquences seulement quand elles apprennent quelque chose ; elle ne s'écrit que pour une décision difficile à défaire, surprenante sans contexte et issue d'un vrai arbitrage.

Règles qui en découlent :

- Une ADR remplacée, en tout ou en partie, voit sa ligne `Status` mise à jour dans le même commit : `superseded by ADR NNN`, ou `accepted — <la clause> est supersédée par l'ADR NNN`.
- Retirer l'historique d'une ADR (stories, revues, plans, critères, pointeurs) n'est pas changer sa décision et ne demande pas d'ADR ; changer une décision, si. L'historique se lit dans git et dans les PR.
- Une règle que la revue doit faire respecter vit dans `CODING_STANDARDS.md` (lu par `/code-review`) ; l'ADR n'en garde que le pourquoi.
- Aucun fichier d'ADR n'est supprimé : leurs numéros sont cités dans le code et les tests (`tests/agents-md.test.ts`). Une ADR qui n'en est pas une se réduit à un renvoi vers l'endroit où vit sa règle.
