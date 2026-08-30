import { join } from 'node:path'

import { createResendMailer } from '@repo/adapter-resend'
import { type Env, getEnv } from '@repo/config'
import { createEmailRenderer } from '@repo/emails'
import { createLocalCaptureMailer } from '@repo/mailer-testing'
import type { Mailer, MailerLogRecord, MailerLogger } from '@repo/ports'
import type { RegistryEmailTemplate } from '@repo/core'

import { moduleRegistry } from './module-registry'

/**
 * Le point de composition du mailer.
 *
 * C'est le seul endroit du dépôt qui sait à la fois qu'il existe un
 * fournisseur, une capture locale et des templates. Le code métier ne connaît
 * que le port `Mailer` (`@repo/ports`) — il ne saura jamais lequel des deux
 * l'exécute, et c'est exactement ce que le port existe pour garantir.
 *
 * **Le choix se fait sur la présence de la clé d'API, jamais sur `NODE_ENV`.**
 * C'est le piège nommé par la story et déjà relevé dans la recherche de s01 :
 * un mailer conditionné par l'environnement est intestable, et se trompera un
 * jour d'environnement — en envoyant de vrais emails depuis une suite, ou en
 * écrivant sur disque en production. `tests/mailer.test.ts` croise les deux
 * axes (production sans clé, développement avec clé) et rougit si `NODE_ENV`
 * reprend la main.
 *
 * Sans clé, l'application **dégrade** (`docs/reliability.md` §2) : l'email est
 * rendu et écrit dans `.mail/`, où il s'ouvre dans un navigateur. Elle ne
 * refuse pas de démarrer.
 */

/** Dossier de capture, relatif au répertoire d'exécution. Ignoré par git. */
export const LOCAL_MAIL_DIRECTORY = '.mail'

export interface AppMailerOptions {
  /** Injecté dans les tests ; lu au démarrage sinon. */
  readonly env?: Env
  readonly captureDirectory?: string
  readonly emails?: readonly RegistryEmailTemplate[]
  readonly logger?: MailerLogger
}

/**
 * Journal par défaut.
 *
 * Il n'écrit que ce que `MailerLogRecord` autorise — la forme est fermée, il
 * n'y a aucun champ où mettre un destinataire, un sujet ou un corps
 * (`docs/security.md` §5). Le port de monitoring arrive en s39 ; d'ici là, la
 * sortie d'erreur du processus est le journal.
 */
const consoleLogger: MailerLogger = (record: MailerLogRecord): void => {
  console.error(record.event, {
    template: record.template,
    code: record.code,
    attempts: record.attempts,
    message: record.message,
  })
}

export function createAppMailer(options: AppMailerOptions = {}): Mailer {
  const env = options.env ?? getEnv()
  const render = createEmailRenderer(options.emails ?? moduleRegistry.emails)
  const logger = options.logger ?? consoleLogger

  if (env.RESEND_API_KEY !== undefined && env.EMAIL_FROM !== undefined) {
    return createResendMailer({
      apiKey: env.RESEND_API_KEY,
      from: env.EMAIL_FROM,
      render,
      logger,
    })
  }

  return createLocalCaptureMailer({
    directory: options.captureDirectory ?? join(process.cwd(), LOCAL_MAIL_DIRECTORY),
    render,
  })
}
