import { AuthNotConfiguredError, type AuthService } from '../application/auth-service'
import { createBetterAuthService, type ConfigureAuthOptions } from './better-auth-service'

/**
 * Le service d'authentification du processus, posé par le **point de
 * composition** de l'application.
 *
 * Pourquoi un singleton posé de l'extérieur plutôt qu'une construction à
 * l'import : le contrat de module est une **valeur**, construite au chargement
 * de `config/features.ts`. À cet instant, il n'existe ni connexion à la base,
 * ni mailer, ni environnement validé — et le CLI (`pnpm ks list`) comme
 * `pnpm db:generate` chargent ce même fichier sans jamais servir de requête.
 * Construire la bibliothèque à l'import obligerait donc chacun d'eux à disposer
 * d'une base et d'une clé de fournisseur d'email.
 *
 * La contrepartie est explicite : tant que `configureAuth` n'a pas été appelée,
 * toute route du module **échoue en le disant**. Elle ne sert pas une requête
 * à moitié.
 */
let service: AuthService | null = null

export function configureAuth(options: ConfigureAuthOptions): AuthService {
  service = createBetterAuthService(options)

  return service
}

export function requireAuthService(): AuthService {
  if (service === null) {
    throw new AuthNotConfiguredError()
  }

  return service
}

/** Défait la configuration. Réservé aux tests, qui en montent plusieurs. */
export function resetAuthService(): void {
  service = null
}
