# ADR 021 — Le socle non désactivable est une liste validée, pas une phrase

- Status: accepted
- Date: 2026-08-31

Certains modules ne peuvent pas être coupés sans casser le produit, et la validation des `requires` ne suffit pas à le dire : les écrans d'authentification vivent dans `apps/web`, que le graphe des modules ne voit pas, si bien que couper `auth` laissait des écrans servis qui postaient vers des routes en 404. Le socle est donc une liste explicite, `requiredModules`, déclarée dans `config/features.ts` et reçue par `resolveEnabledModules` (`packages/core/src/validate.ts`), qui refuse en le nommant un module du socle absent des activés, et un module du socle absent de l'annuaire (sans quoi une faute de frappe désarmerait la règle en silence). Tous les points de composition la transmettent : le registre de l'application, `pnpm db:generate`, `db:migrate` et `db:seed`, `ks toggle` (qui soumet la configuration candidate à la même validation avant toute écriture) et le serveur MCP.

Le socle compte aujourd'hui `auth` — sans compte, pas de SaaS — et `rate-limit` — optionnel, il laisserait toute installation par défaut exposée sur la connexion, l'inscription et la réinitialisation de mot de passe. Ce qui d'autre doit y entrer est ouvert (#184).

## Considered options

- Un drapeau sur la définition de module (`socle: true`) — rejeté : la propriété appartient au projet qui installe le module, pas au module ; le même module peut être optionnel ailleurs.
- Une constante dans `@repo/core` — rejetée : le cœur reçoit la configuration, il ne la lit pas et ne connaît pas l'identifiant `auth` ; c'est ce qui permet aux tests de construire d'autres registres.
- Laisser le CLI porter la règle — rejeté : un `config/features.ts` édité à la main doit être refusé au démarrage aussi.

## Consequences

- « Tous les modules coupés » n'est pas une configuration valide ; la configuration minimale est le socle, éprouvée par `pnpm test:socle`.
- Ajouter un identifiant à `requiredModules` retire au propriétaire du projet le droit de couper ce module : la liste reste courte et justifiée.
- La liste est facultative pour `resolveEnabledModules`, afin que les registres d'essai restent libres ; un point de composition qui oublierait de la transmettre désarmerait la règle, d'où des tests qui éprouvent la chaîne jusqu'au binaire `ks`.
