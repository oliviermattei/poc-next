# ADR 075 — Les anciens chemins d'écran sont une table, lue par le proxy

- Status: accepted
- Date: 2026-09-28
- Scope: story s62a-reglages-deplacement

## Context
s62a déplace trois écrans (`/account`, `/organizations`, `/billing`) sous `/app/settings/*`, et s62b, s62c, s63 en déplaceront d'autres. Les anciens chemins sont dans des favoris, des emails déjà envoyés, des retours de paiement en vol. Le dépôt n'a **aucune** infrastructure de redirection : pas de `redirects()` dans `next.config.ts`, aucun `308` dans `apps` ni `packages` ; `apps/web/proxy.ts` ne sait que la redirection canonique de langue (307) et la réécriture interne.

## Decision
Une **table unique** (ancien chemin interne → nouveau chemin interne), donnée TypeScript dans `apps/web/lib/`, lue par `apps/web/proxy.ts` **sur le chemin interne** (après retrait du préfixe de langue), qui répond **308** vers la cible re-préfixée dans la langue de la requête, requête conservée. Une entrée n'est servie que si l'écran cible existe dans la configuration (module activé) ; sinon l'ancien chemin répond comme aujourd'hui (404). Un test compare la table à une **fixture figée** des anciens chemins : chaque ancien chemin doit être soit servi, soit redirigé.

## Considered options
- **`redirects()` de `next.config.ts`** — rejetée : `output: 'standalone'` fige la configuration au build (`AGENTS.md`, Deployment), la cible ne peut pas dépendre des modules activés, et l'ordre avec la réécriture de langue du proxy n'est pas maîtrisé.
- **Une page par ancien chemin qui appelle `permanentRedirect`** — rejetée : un fichier d'écran par redirection, qui réserve un segment et qu'il faut ranger dans une zone (`tests/zones.test.ts`), pour un simple aiguillage.
- **Pas de redirection** — rejetée : casserait les liens d'emails et de paiement déjà émis.

## Consequences
- Chaque story qui déplace un écran ajoute une ligne à la table et à la fixture ; oublier la ligne fait rougir le test.
- Les segments redirigés restent réservés aux organisations (`APPLICATION_SEGMENTS`) même sans fichier d'écran.
- La cible est toujours une constante de la table, jamais un paramètre : pas de redirection ouverte.
