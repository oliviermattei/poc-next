import type { AdminSecurityLog } from '../domain/security-event'

/**
 * Le journal par défaut des événements de sécurité du module
 * (`docs/security.md` §7).
 *
 * La sortie standard du processus, comme pour `auth` et `organizations` : le
 * port de supervision arrive en s39, et inventer ici un second mécanisme serait
 * à jeter. Il n'y a rien à filtrer avant d'écrire — la forme de l'événement est
 * fermée, chaque champ y est nommé, aucun champ libre
 * (`domain/security-event.ts`).
 */
export const consoleSecurityLog: AdminSecurityLog = (event) => {
  console.info(event.event, { actor: event.actor, target: event.target })
}
