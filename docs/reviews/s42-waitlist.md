# Review — s42-waitlist

> Contexte neuf. Diff jugé : 25 fichiers, un commit `e6dd0a9`.

## Ce que la revue a joué elle-même

`pnpm test` **2955 verts**, 14 sautés, 99 fichiers — et le bloc adossé à PostgreSQL a **réellement tourné** (vérifié en mode verbeux : les cas de base de la liste d'attente sont dans la liste des exécutés, pas des sautés). `typecheck` rejoué **sans cache**, `lint` vert. `E2E_PORT=3142 … e2e/public-forms.spec.ts` : 7 verts. **`pnpm test:socle`** — la branche de CI qui coupe `marketing` — exerce l'état coupé de bout en bout sous un vrai `next build` : `/waitlist` **404**, la route **404**.

## Les quatre garanties empruntées, vérifiées sur une ligne de liste d'attente

Elles ne sont pas héritées sur parole : la catégorie de données et la rétention portent sur **la table**, la purge et l'export **sur l'adresse**. Le test adossé à la base inscrit la **même adresse** aux deux listes, exporte deux lignes, purge, ré-exporte vide. Filtrer l'export sur la seule newsletter le rend rouge.

## Anti-hallucination

Chaque import ouvert. Rien d'inventé. Les valeurs tiennent : `default` vaut bien 120 par minute et `publicForm` 60 par dix minutes, donc l'affirmation « vingt fois trop large » du commentaire de route est arithmétiquement juste.

**Le refactor est fidèle** : la fonction d'analyse est **identique octet pour octet** à l'ancienne (comparée contre `dev`), et l'ordre du cas d'usage de la newsletter est préservé. Aucune référence pendante.

## Mutations — neuf, zéro verte

Retirer la politique de débit **de la seule route de la liste d'attente** rougit en nommant la route et la politique obtenue. Écrire la mauvaise source rougit à 4. Retirer le champ leurre rougit des **trois** côtés. Ajouter la clé « adresse invalide » rougit à 2. Répondre 400 sur une adresse malformée rougit à 3.

**Réserve honnête sur la première** : l'assertion **ré-implémente** la résolution `?? 'default'` du garde plutôt que de l'exercer. Elle mord sur le contrat de la route — là où le défaut vivrait — mais rien ne fait passer 61 requêtes dans le vrai garde pour observer le 429.

## Les trois invariants nommés, vérifiés un par un

**Aucune clé « adresse invalide »** : les cinq clés sont comparées **par dérivation** aux cinq de la newsletter, avec une garde d'inertie et l'exigence inverse pour le formulaire de contact, qui lui en a une. Les trois cas sont indistinguables **en statut et en corps**, prouvé au cas d'usage et au niveau HTTP.

**Le piège survit** : nommé une fois, exporté, rendu génériquement — la liste d'attente l'obtient sans une ligne à elle — et une soumission piégée reçoit 200.

**La page d'accueil est inchangée** : le rendu de la racine ne contient ni la route ni le libellé, et toutes les sections configurées rendent toujours.

## Constats

**1. minor — une phrase de règle mutilée par la réécriture** (`apps/web/AGENTS.md:508`) : il manque « qu'aucune liste ne soit recopiée », qui était tout le propos.

**2. minor — les deux commentaires que cette story *accomplit* parlent encore au futur** (`marketing/src/schema.ts:41` et `:46`) : « réutilisée par s42 », « `waitlist` en s42 ». **P38bis dit exactement qu'un commentaire promettant une story future pourrit en silence** — et la story qui tient la promesse est celle qui doit la retirer.

**3. minor — une assertion tautologique** (`tests/marketing.test.ts:507`) : elle compare la longueur des routes à celle d'une liste **dérivée de ces mêmes routes**. Elle ne peut pas échouer, et elle est posée juste au-dessus de celle qui tient réellement le plancher. Elle **se lit comme de la couverture et n'en est pas** — précisément ce que la réécriture devait éviter.

**4. minor — une absence assertée sans signal positif** (`e2e/public-forms.spec.ts:192`) : une page d'accueil qui n'aurait pas rendu du tout rendrait le cas vert. L'invariant est correctement tenu par le test noeud ; le cas navigateur ajoute peu.

**5. minor — asymétrie de couverture entre les jumelles** : au niveau route, la newsletter a ses trois cas identiques **et** son cas de piège ; la liste d'attente n'a que « nouvelle » et « doublon ». Le comportement ne peut pas diverger aujourd'hui — un seul chemin —, et ce fichier dérive déjà ses balayages du contrat : les deux cas auraient couvert les deux listes gratuitement.

**6. minor, non imputable à ce diff — `pnpm test:socle` sort en 1 sur cette machine**, sur un cas de stockage sans rapport avec `marketing`, qui est coupé dans cette branche. À rejouer sur `dev` pour trancher.

## Jugé et accepté — de la dérive, mais le bon choix

**Le refus au démarrage** quand les deux sources sont égales : jamais demandé par le plan, mais l'échec qu'il prévient est **silencieux** — l'index fusionne les listes, et un abonné qui rejoint la liste d'attente reçoit 200, sans ligne, sans courriel, sans que rien ne le dise. À garder.

**`WaitlistView`** contre le « aucun composant neuf » du plan : la lecture tient. Rien n'a atterri dans `packages/ui`, `PublicForm` est réutilisé tel quel, et le module possède ses écrans publics — l'inverse aurait fait rendre le pied de page du module par l'application.

**Les deux tests réécrits ne sont pas affaiblis** : dériver du contrat est **strictement plus fort** que deux littéraux recopiés — une quatrième route entre désormais dans le balayage sans qu'on le demande — et la garde d'inertie a troqué une égalité exacte contre un plancher qui **survit** à une quatrième route au lieu de casser dessus.

## Non vérifié

- **L'écran n'a jamais été regardé.** Preuves de comportement, aucune de rendu : la suite compile à la demande, et le seul passage sous `next build` avait `marketing` coupé. Geste humain : ouvrir la page, vérifier la ligne champ + bouton à 390 px et en largeur bureau, et la lisibilité du message de confirmation dans les deux thèmes.
- **La seconde moitié du critère 4 est invérifiable ici** : la vue de back-office appartient à `s37c`, qui n'a pas atterri. À relire quand elle sera fusionnée.
- **La limitation effective n'a jamais été observée sur cette route** : le nom de la politique est asserté sur le contrat, aucun test ne provoque le 429.
- **Aucun tiers réel contacté** : les courriels sont capturés sur disque.

Max severity: minor
Ship allowed: yes
