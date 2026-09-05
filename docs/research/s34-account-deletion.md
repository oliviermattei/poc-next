# Research — Story s34-account-deletion

> Vérifiée contre `dev` au commit `1a4a838`, en lecture seule. Aucune base, aucun conteneur, aucun worktree.

## Les cinq faits structurants

1. **`purgeModules` est exportée et appelée par rien.** `packages/core/src/registry.ts:401` la définit, `index.ts:30` la réexporte, et le balayage sur `apps/` et `packages/` hors tests ne trouve **aucun appelant**. C'est le motif exact que `s33` vient de fermer sur la clé `jobs` du contrat : une capacité déclarée dans le socle, agrégée, jamais consommée. **s34 est la story qui la branche** — et c'est sa vraie nature, plus que « ajouter un écran de suppression ».

2. **Le critère 4 n'a aucun satisfaisant dans la configuration livrée, et son propre exemple le contredit.** Sur **seize** catégories de rétention déclarées par les modules, **une seule** vaut `'anonymize'` : `demo-notes`, dans `demo-disabled` — un module **délibérément absent** de `config/features.ts:101`, dont l'existence même sert à prouver qu'un module coupé ne laisse aucune trace. Les quinze autres valent `'erase'`.
   Or le critère dit : *« les catégories marquées « anonymiser » — **typiquement les factures et journaux de paiement, dont la conservation est légalement requise** — voient le lien vers l'utilisateur rompu ».* Mesuré : `billing` déclare `'billing-customer'`, `'guest-checkout'`, `subscription` et `purchase` **toutes en `'erase'`**. L'exemple que le critère donne n'existe pas dans le produit.
   **C'est une prémisse fausse, et elle se répare dans la story, pas au plan.** Deux sorties, qui n'ont pas les mêmes conséquences : soit le critère a raison et la rétention de `billing` est à corriger — une facture effacée est un problème comptable, pas seulement produit —, soit `billing` a raison et le critère cite un exemple qui n'a jamais été implémenté. À trancher explicitement, parce que dans les deux cas **un test du critère 4 balaierait aujourd'hui zéro catégorie réelle** : c'est le défaut de balayage vide, sur une story RGPD.

3. **Un module déclare une purge vide alors qu'il porte une donnée liée au compte.** `admin/src/module.ts:63` — `purge: async () => {}` —, or `admin_platform_role` porte les habilitations de superadmin, clé étrangère vers `auth_user` en `onDelete: 'cascade'`. La cascade fait le travail, donc le comportement est correct ; mais rien ne le **dit**, et rien ne vérifie que la cascade existe encore. Trois autres purges vides (`blog`, `docs`, `mcp-server`) sont légitimes — ces modules ne portent aucune donnée de compte. La distinction n'est écrite nulle part.

4. **Le repli synchrone est déjà livré et éprouvé.** `s33` a posé le port de jobs avec sa dégradation : module coupé, l'émission s'exécute dans la requête appelante, et un cas le mesure. Le critère 9 — « la suppression aboutit que le module de jobs soit activé ou non » — hérite donc d'un mécanisme existant au lieu d'en créer un. C'est la première story à en profiter, et `createRecordingJobs` de `s33` attendait précisément son premier appelant.

5. **La revue de `s32` a déjà posé la règle que ce critère 3 va exercer.** Elle a trouvé qu'une charge utile de notification portait l'adresse email d'un tiers, et que la purge — qui efface ce qui est *adressé à* un compte — ne touche jamais ce qui le *nomme*. D'où la scission `data`/`stored` : ce qui est écrit et relu ne porte que des **références**. s34 est la story qui vérifie que cette règle tient : après suppression, aucune ligne conservée ne doit nommer le compte effacé.

## Target story

Dix critères. Confirmation explicite par saisie · purge de **chaque module activé**, un échec interrompt et laisse rejouable · effacement des données personnelles partout, fichiers et notifications compris · application de la politique de rétention déclarée · suppression d'organisation avec retrait des membres et annulation de l'abonnement · refus au dernier propriétaire, avec message · sessions révoquées et reconnexion impossible · email de confirmation · aboutit avec ou sans le module de jobs · un module non activé n'est pas appelé et ne laisse pas d'orphelins.

Dépendances déclarées : `s33` (fusionnée ce jour), `s18`, `s19`, `s17` — toutes fusionnées.

## Points d'ancrage

- `packages/core/src/registry.ts:401` — `purgeModules`, sa signature et son ordre d'appel.
- `config/features.ts:83,101` — la raison écrite pour laquelle `demo-disabled` n'est jamais activé.
- `packages/modules/auth/src/application/auth-use-cases.ts` — `purgeAccount`, qui supprime la ligne `auth_user` et laisse les cascades faire.
- `packages/modules/billing/src/module.ts` — les quatre catégories, toutes en `erase`.
- `packages/modules/storage/src/module.ts` — la seule purge qui touche des fichiers, donc un tiers.
- `apps/web/lib/notifications.ts` — la résolution des références, à vérifier après effacement (fait 5).

## Pièges & contraintes

- **Rejouable veut dire prouvé deux fois.** `docs/reliability.md` : « Idempotent is proven by running it twice and observing one effect, never asserted in a comment. » Le critère 2 dit « laisse l'opération rejouable » : une suppression interrompue puis relancée doit aboutir sans double effet.
- **L'ordre d'appel des purges n'est pas neutre.** `auth` supprime la ligne dont les autres dépendent par cascade ; le purger en premier effacerait des données que les autres modules devaient traiter eux-mêmes. L'ADR 029 fixe déjà que `requires` ordonne la purge — à vérifier plutôt qu'à supposer.
- **Un tiers peut échouer.** Le stockage et le fournisseur de paiement sont des appels sortants ; le critère 2 exige que l'échec interrompe. Attention à ne pas laisser un compte à moitié effacé sans trace.
- **La confirmation par saisie est une frontière.** Zod, et la comparaison côté serveur — jamais une comparaison côté client qui déciderait de l'appel.
- **Ne pas confondre suppression de compte et suppression d'organisation.** Deux critères distincts, deux périmètres, et le critère 6 dit que l'un bloque l'autre.

## Questions ouvertes

- **Le critère 4 : corriger la rétention de `billing`, ou corriger le critère ?** C'est la décision principale, elle a des conséquences comptables, et elle mérite un ADR. Non tranchée ici : c'est un arbitrage produit, pas une lecture de code.
- **La purge vide d'`admin` doit-elle le rester ?** La cascade suffit aujourd'hui. Mais rien ne vérifie que la cascade existe, et une story future qui retirerait `onDelete: 'cascade'` laisserait des habilitations orphelines en silence.
- **Que devient l'écran après suppression ?** Le compte n'existe plus, la session est révoquée : la redirection ne peut pas passer par une route authentifiée.
- **L'email de confirmation part-il avant ou après l'effacement ?** Après, l'adresse n'existe plus dans le produit ; avant, la suppression peut encore échouer. Le critère 8 ne tranche pas.

## Complexité réelle

Notée **3** dans `docs/stories.md`. **Ma note : 4.**

Dix critères, treize modules à purger, deux tiers qui peuvent échouer, une opération qui doit être rejouable, un ordre d'appel qui compte, et **une prémisse fausse à réparer avant de commencer** (fait 2). La note de 3 suppose que « la purge existe déjà, il ne reste que l'écran » — or ce qui existe est un contrat que rien n'appelle, comme la clé `jobs` avant `s33`.

**Proposition de découpe, si le plan dépasse dix tâches** : *la suppression de compte* d'un côté — confirmation, purge de tous les modules, rétention, sessions, email — et *la suppression d'organisation* de l'autre, qui ajoute l'annulation chez le fournisseur de paiement et la règle du dernier propriétaire. La seconde ne close seule que si la première a livré le mécanisme.
