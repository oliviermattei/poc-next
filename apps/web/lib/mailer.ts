import { join } from 'node:path'

import { createResendMailer } from '@repo/adapter-resend'
import { type Env, getEnv } from '@repo/config'
import { createEmailRenderer } from '@repo/emails'
import { createLocalCaptureMailer } from '@repo/mailer-testing'
import type { Mailer, MailerLogRecord, MailerLogger } from '@repo/ports'
import type { RegistryEmailTemplate } from '@repo/core'

import { LOCAL_MAIL_DIRECTORY, resolveMailerConfig } from './mailer-config'
import { moduleRegistry } from './module-registry'

/**
 * Le point de composition du mailer.
 *
 * C'est le seul endroit du dépôt qui sait à la fois qu'il existe un
 * fournisseur, une capture locale et des templates. Le code métier ne connaît
 * que le port `Mailer` (`@repo/ports`) — il ne saura jamais lequel des deux
 * l'exécute, et c'est exactement ce que le port existe pour garantir.
 *
 * **Le choix se fait sur la configuration — la clé du fournisseur ou le drapeau
 * de capture — jamais sur `NODE_ENV`.** C'est le piège nommé par la story et
 * déjà relevé dans la recherche de s01 : un mailer conditionné par
 * l'environnement est intestable, et se trompera un jour d'environnement — en
 * envoyant de vrais emails depuis une suite, ou en écrivant sur disque en
 * production. `tests/mailer.test.ts` croise les deux axes (production sans clé,
 * développement avec clé) et rougit si `NODE_ENV` reprend la main.
 *
 * **La capture locale est un opt-in, pas un repli.** `docs/reliability.md` §2
 * prescrit la capture « en développement local » ; l'étendre à tout
 * déploiement dépourvu de clé faisait rendre `{ok:true}` sur un email que
 * personne ne recevrait, indiscernable d'un envoi réussi — en production aussi
 * (revue s06, F3). `EMAIL_LOCAL_CAPTURE=1` la demande explicitement ; sans clé
 * et sans ce drapeau, rien ne se monte.
 *
 * La règle elle-même est dans `mailer-config.ts`, d'où `next.config.ts` la
 * réapplique au démarrage : le montage et la garde de démarrage ne peuvent pas
 * diverger, et la configuration de Next n'a pas à charger le SDK du
 * fournisseur pour poser une question à trois variables.
 */

export { LOCAL_MAIL_DIRECTORY } from './mailer-config'

/**
 * Le **budget d'attente** de l'appelant, choisi ici et pas subi.
 *
 * Aux défauts de l'adapter (10 s de délai, 3 essais), un fournisseur muet fait
 * attendre ~31 s avant de rendre `{ok:false}` : au-delà du plafond usuel d'une
 * fonction serverless, la plateforme coupe la requête et il ne reste ni
 * réponse ni journal. Deux essais de 4 s, recul compris, tiennent sous 10 s —
 * `tests/mailer.test.ts` le mesure.
 *
 * Le nombre d'essais reste supérieur à 1 : la reprise est ce qui absorbe une
 * panne passagère du fournisseur, et la clé d'idempotence la rend sûre.
 */
const APP_MAILER_TIMEOUT_MS = 4_000
const APP_MAILER_MAX_ATTEMPTS = 2

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

  // La règle qui décide vit dans `mailer-config.ts` — partagée avec la garde de
  // démarrage de `next.config.ts`, pour que les deux ne puissent pas diverger.
  // Elle lève, en nommant les deux variables, quand rien n'est configuré : le
  // schéma d'environnement, lui, ne l'exige d'aucun processus.
  const config = resolveMailerConfig(env)

  if (config.kind === 'provider') {
    return createResendMailer({
      apiKey: config.apiKey,
      from: config.from,
      render,
      logger,
      timeoutMs: APP_MAILER_TIMEOUT_MS,
      maxAttempts: APP_MAILER_MAX_ATTEMPTS,
    })
  }

  return createLocalCaptureMailer({
    directory: options.captureDirectory ?? join(process.cwd(), LOCAL_MAIL_DIRECTORY),
    render,
  })
}
