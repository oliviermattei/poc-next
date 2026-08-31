# État de reprise — killer-boilerplate

> Fichier de passation. À lire **en premier** après un `/clear`. La vérité reste dans les fichiers du dépôt ; ceci dit seulement où on en est et comment on travaille.

## Où on en est

| Story | État |
|---|---|
| s01 → s08 | **closes**, revues, correctifs appliqués |
| s09-i18n | en cours (implémenteur lancé) |
| s10 → s45 | à faire — 36 stories |

Tests : **588 + 2 ignorés**, 20 parcours end-to-end, déterministes (`retries: 0`).
ADR : **22**. Branche : `dev`. Commits : un par story, plus `docs:` pour recherche, plan, revue.

## Environnement (à refaire après un redémarrage de session)

```bash
export PATH="/Users/olivier/.nvm/versions/node/v22.17.0/bin:$PATH"   # pnpm sinon absent
open -a Docker && docker compose up -d                                # Postgres, base `app`
```

## La boucle, par story

1. **Recherche** → `docs/research/<id>.md`. Vérifier les API dans les **paquets installés**, jamais dans la doc en ligne.
2. **Plan** → `docs/plans/<id>.md`, `validated: yes` (le propriétaire a délégué la validation).
3. **Implémenteur** (subagent `implementer`) → un commit sur `dev`.
4. **Reviewer** (subagent `reviewer`, contexte frais) → **écrit lui-même** son rapport dans `docs/reviews/<id>.md`, ne me renvoie que verdict, findings bloquants, décisions à prendre, non-vérifié.
5. Si `Ship allowed: no` → tour de correction, puis nouvelle revue.

**Protocole de contexte** : les agents écrivent les rapports dans les fichiers ; je ne fais pas transiter les corps de rapport par ma conversation. Mes messages restent courts.

## Prochaine étape après s09

Le chemin critique s'arrête à s09. Ensuite **cinq voies parallèles** : s10 marketing, s12 OAuth, s13 2FA, s14 passkeys, s15 organisations. Jusqu'à trois worktrees de front (`isolation: "worktree"` sur l'outil Agent), en sérialisant ce qui touche les fichiers chauds : `config/features.ts`, `generated/`, `turbo.json`, `eslint.config.ts`, `pnpm-lock.yaml`, `AGENTS.md`.

## Ce qu'un agent doit savoir avant d'écrire une ligne

Lire `AGENTS.md` (racine + package), `docs/architecture.md`, `docs/security.md`, `docs/reliability.md`, `docs/design-system.md`, et les ADR concernés.

Décisions structurantes déjà prises : contrat de module à 13 clés (ADR 007) · annuaire statique, code d'un module désactivé présent dans le bundle serveur (016) · `ModuleRoute[]` transitoire jusqu'à Hono (017) · clé étrangère inter-modules seulement vers un requis déclaré (018) · ordre canonique de `enabledModules` (019) · connexion injectée aux modules, un module n'importe jamais `@repo/db` (020) · socle non désactivable, exécutable (021) · **Radix, pas Base UI** — jamais de version stable publiée (022).

## Modes d'échec silencieux déjà rencontrés — les chercher systématiquement

1. Test vert par accident (suppression no-op + ajout no-op) — s05
2. Garde `catch` trop large transformant une restauration en suppression — s05
3. Postcondition traversée par la récupération d'erreur de TypeScript — s05
4. Garde textuelle contournée par un guillemet, un accent grave, une extension, un paquet unifié — s07, s08
5. Configuration plate ESLint qui **remplace** les options : ajouter une garde en efface une autre — s08
6. `retries: 1` transformant une fuite de secret reproductible en badge jaune — s08
7. Assertion qui ne peut pas échouer (URL pré-redirection satisfaisant déjà le motif) — s08
8. Test qui **inventorie** au lieu de **vérifier** (`.env.example` comparé par noms de clés) — s06

**Règle** : une mutation qui reste verte signifie que le test est faux, pas que le code est juste.

## Dettes ouvertes, nommées

- `e2e/modules.spec.ts:55` rouge quand **tous** les modules sont activés — trou s03, à traiter **avant s26**.
- `jsx-a11y` sans version compatible ESLint 10 (6.10.2, pair `^9`) — accessibilité portée par Radix, les rôles ARIA et la vérification visuelle en revue.
- Composants `Form`/`FormField` nommés par le design system, non construits — décision reportée (react-hook-form + Zod partagé côté client).
- La CI n'a **jamais** tourné : aucun run GitHub Actions. Toutes les étapes ont été jouées localement.
- Aucun déploiement réel, aucun envoi d'email réel (pas de clé Resend), aucune politique de sécurité du contenu (c'est s45).
