# ADR 004 — Better Auth comme socle d'authentification

- Status: accepted
- Date: 2026-08-30
- Scope: framing

## Context
Les stories s07, s12, s13, s14, s15, s16, s17 et s37 couvrent mot de passe, magic link, vérification, réinitialisation, sessions, OAuth, TOTP, codes de secours, passkeys, organisations, invitations, rôles, superadmin et impersonation. Écrire cela à la main représente plusieurs semaines et autant de surfaces de sécurité.

## Decision
Better Auth, avec ses plugins `organization`, `admin`, `two-factor` et `@better-auth/passkey`. Le schéma des tables d'authentification est généré par Better Auth et intégré au schéma Drizzle du module `auth`.

Le module `auth` fait partie du socle non désactivable.

## Considered options
- Auth.js / NextAuth — rejeté : ne fournit ni organisations, ni rôles, ni impersonation, ni gestion de passkeys. Il faudrait construire s15 à s17 et s37 entièrement.
- Supabase Auth — rejeté avec ADR 003 : imposerait Supabase comme base.
- Clerk ou WorkOS — rejeté : externalise les utilisateurs chez un tiers payant, contredit « posséder ses données » du PRD, et rend la suppression de compte (s34) dépendante d'une API externe.
- Implémentation maison — rejeté : le PRD veut du code compris, pas du code réécrit. La cryptographie de WebAuthn et de TOTP n'est pas un endroit où apprendre.

## Consequences
Facilité : quatre stories d'authentification avancée deviennent essentiellement de l'interface.
Difficulté : dépendance forte à une bibliothèque jeune ; ses migrations de schéma se propagent au module `auth`.
À surveiller : Better Auth impose sa forme de tables. Les entités métier ne doivent jamais référencer directement ses tables internes, mais passer par le module `auth`.
