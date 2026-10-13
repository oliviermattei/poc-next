# ADR 004 — Better Auth comme moteur d'authentification

- Status: accepted — l'emploi du plugin `organization` est supersédé par l'ADR 025
- Date: 2026-08-30

Mot de passe, magic link, vérification, réinitialisation, sessions, OAuth, TOTP, codes de secours et passkeys représentent plusieurs semaines de code et autant de surfaces de sécurité. Better Auth en est le moteur, avec ses plugins `magic-link`, `generic-oauth`, `two-factor` et `@better-auth/passkey`, enfermé dans le module `auth` (socle non désactivable, ADR 021). La bibliothèque ne possède rien d'autre que ses algorithmes : le schéma est celui du module, les emails passent par le port `Mailer`, les routes par le registre, la session par le répartiteur (`packages/modules/auth/AGENTS.md`). Les organisations (ADR 025) et l'impersonation (ADR 064) sont écrites dans les modules, hors de ses plugins.

## Considered options

- Auth.js / NextAuth — rejeté : ne fournit ni passkeys, ni TOTP, ni codes de secours ; il faudrait les écrire.
- Clerk ou WorkOS — rejetés : les utilisateurs vivraient chez un tiers payant, contre « posséder ses données » du PRD, et la suppression de compte dépendrait d'une API externe.
- Implémentation maison — rejetée : la cryptographie de WebAuthn et de TOTP n'est pas un endroit où apprendre.

## Consequences

- Dépendance forte à une bibliothèque jeune : ses changements de schéma se propagent au module `auth`.
- Les autres modules ne référencent jamais les tables internes de Better Auth ; ils passent par le module `auth`.
