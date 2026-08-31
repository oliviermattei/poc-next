import type { SecurityLog } from '../application/ports'

/**
 * Le journal par défaut des événements de sécurité du module
 * (`docs/security.md` §7).
 *
 * La sortie standard du processus, comme pour le module `auth` : le port de
 * supervision arrive en s39, et inventer ici un second mécanisme serait à jeter.
 * Il n'y a rien à filtrer avant d'écrire — la forme de l'événement est fermée,
 * chaque champ y est nommé, aucun champ libre (`domain/security-event.ts`, qui
 * est la liste : le compte écrit ici disait « cinq » pour six, revue de s17 F2).
 */
export const consoleSecurityLog: SecurityLog = (event) => {
  console.info(event.event, {
    actor: event.actor,
    organizationId: event.organizationId,
    target: event.target,
    role: event.role,
    transfersOwnership: event.transfersOwnership,
  })
}
