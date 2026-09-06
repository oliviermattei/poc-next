---
story: s37b1-decompte-et-impersonation
validated: yes
---

# Plan — s37b1-decompte-et-impersonation

> Planifié contre `dev` au commit `40a9caf`, sur la recherche de `s37b` (framing doc sur `dev`). Cette tranche porte **toute la sécurité** de `s37b` : la dette reportée de `s37a`, mesurée contre PostgreSQL, et l'élévation de privilège.

## La dette, et pourquoi elle n'est pas une amélioration

Deux séquences de gestes **tous permis** laissent la plateforme sans superadmin capable de se connecter, et **aucune commande ne la répare** — il faut un `UPDATE` à la main en production :

- bannir un pair, puis **se bannir soi-même** — les deux rendent 200, le décompte voit deux lignes ;
- bannir un pair, puis **révoquer l'autre** — la révocation voit une ligne et autorise.

Les deux ont été mesurées en revue de `s37a`. Et une **troisième surface** partage l'aveuglement : `grantSuperadmin` ne prend même pas le verrou consultatif que les deux autres écritures prennent.

## Le point dur, à trancher avant d'écrire

`readFacts` compte les lignes de `admin_platform_role` **sous `pg_advisory_xact_lock`**, sur l'exécuteur de la transaction. L'état « banni » vit dans `auth`, derrière `AdminAccountsPort` — **qui emploie sa propre connexion**. Appeler le port depuis la transaction lirait donc un état hors transaction : ni l'atomicité que `s37a` a payée d'un constat critique, ni une lecture cohérente.

**Et la jointure est interdite, pour une raison écrite.** `admin/src/schema.ts` pose la borne : ce fichier est le seul du module à importer `@repo/module-auth`, « c'est la borne qui garde les lectures de comptes derrière le port injecté, donc derrière un identifiant plutôt qu'une adresse » (`docs/security.md` §7).

**Piste, à vérifier et non à croire** : toutes les écritures de bannissement passant par `banUnlessLastSuperadmin`, qui tient le verrou, une lecture des identifiants de rôle **sous le verrou** suivie d'une question au port sur **cet ensemble précis** pourrait suffire — aucun bannissement concurrent ne peut s'y glisser. **Mesurer que c'est vrai** : chercher toute autre écriture de `auth_user.banned`, et dire ce qui a été balayé.

## Tâches

- [x] **1. Établir le chemin d'écriture réel de `banned`.** Balayer toutes les écritures de `auth_user.banned` — hors `banUnlessLastSuperadmin`, y en a-t-il ? La réponse décide si la piste ci-dessus tient. **Si elle ne tient pas, s'arrêter et le dire** : la forme du correctif change.
- [x] **2. Élargir `AdminAccountsPort`, pas le schéma.** Ce que le port rend doit permettre de compter les superadmins **capables de se connecter** sans que `admin` lise la table d'`auth`. Le doublure de test et l'implémentation réelle suivent.
- [x] **3. Les trois surfaces partagent le même décompte.** Révocation, garde-fou de bannissement, **et promotion**. Un décompte corrigé à deux endroits sur trois ne corrige rien — c'est l'erreur exacte de ma première rédaction du critère. Mutation : corriger deux surfaces et laisser la troisième doit rougir.
- [x] **4. Les deux séquences mesurées deviennent des cas.** Bannir un pair puis se bannir ; bannir un pair puis révoquer l'autre. **Contre une vraie base**, comme la revue de `s37a` les a mesurées — pas contre une doublure.
- [x] **5. `grantSuperadmin` prend le verrou.** Même clé que les deux autres. Mutation : le retirer doit rougir sur un cas **concurrent**, pas séquentiel — `s34` a montré qu'un cas séquentiel laisse la mutation verte.
- [x] **6. L'impersonation, écrite à la main.** Une colonne, `impersonatedBy` sur la session. **Rotation de session obligatoire** (`docs/security.md`) : une élévation de privilège ne réutilise jamais l'identifiant de session en cours.
- [x] **7. Les deux refus qui comptent.** Impersonner un superadmin : refusé. **Enchaîner** depuis une session déjà empruntée : refusé aussi — ce n'était dans aucun critère de `s37b`, et c'est le genre de chemin qu'on découvre en production. Mutation pour chacun.
- [x] **8. La journalisation aux deux bouts, et la fin qui n'arrive jamais.** Début et fin, avec les deux identifiants. **Une session d'impersonation qui expire sans sortie explicite compte comme une fin** — sinon le second événement n'est jamais émis et le journal ment par omission.
- [x] **9. Module coupé.** Aucune impersonation, aucun décompte. `pnpm test:minimal-profile` dérive déjà cette famille ; vérifier qu'il **balaie effectivement** ce module plutôt que de le supposer.
- [x] **10. ADR — l'impersonation s'écrit à la main.** Avec la mesure, pas le seul précédent : le greffon `admin` de Better Auth déclare `banned`, `banReason`, `banExpires` et `impersonatedBy`, or `s37a` a déjà livré `banned`, `bannedAt` et `bannedReason`. L'adopter signifierait un modèle de bannissement en double pour une capacité dont **une seule colonne** est nécessaire.

## Ce que la story ne fait pas

Aucun écran — ni back-office, ni bandeau : c'est `s37b2`. Elle ne touche pas au refus à la connexion de `s37a`, dont les mutations sont acquises.

## Sections de `docs/security.md` touchées

Rotation de session à l'élévation de privilège · journalisation d'une élévation · 404 plutôt que 403 · permissions vérifiées côté serveur · **aucun état de sécurité lu hors de la transaction qui décide**.
