import type { SecurityLog } from '../application/ports'

/**
 * Le journal par défaut des événements de sécurité (`docs/security.md` §7).
 *
 * Il écrit ce que `describeSecurityEvent` a déjà filtré, et rien d'autre : la
 * forme est fermée, il n'y a aucun champ où glisser un jeton ou un mot de
 * passe. Le port de monitoring arrive en s39 ; d'ici là, la sortie standard du
 * processus est le journal — c'est déjà le choix fait par le mailer en s06.
 */
export const consoleSecurityLog: SecurityLog = (record) => {
  console.info(record.event, { actor: record.actor, ...record.details })
}
