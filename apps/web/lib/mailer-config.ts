import { EMAIL_LOCAL_CAPTURE_ENABLED, type Env } from '@repo/config'

/**
 * **La règle qui décide du mailer**, isolée de ce qui le construit.
 *
 * Elle vit ici, et pas dans le schéma d'environnement, parce qu'elle ne
 * concerne que les processus qui montent un mailer : `pnpm db:migrate`
 * n'envoie aucun email et doit s'exécuter avec le seul `DATABASE_URL` (revue
 * de s06, G3). Le schéma juge la **forme** des variables, pour tout le monde ;
 * l'exigence « il faut un mailer » est portée par cette fonction, appliquée à
 * deux endroits :
 *
 * - `apps/web/next.config.ts`, au **démarrage** de l'application — un choix
 *   manquant échoue avant la première requête, pas au premier email envoyé ;
 * - `lib/mailer.ts`, au montage, qui construit l'implémentation correspondante.
 *
 * Fichier séparé de `lib/mailer.ts` à dessein : la configuration de Next serait
 * sinon obligée de charger le SDK du fournisseur, React Email et le registre de
 * modules pour poser une question à trois variables.
 */
/** Dossier de capture, relatif au répertoire d'exécution. Ignoré par git. */
export const LOCAL_MAIL_DIRECTORY = '.mail'

export type MailerConfig =
  | { readonly kind: 'provider'; readonly apiKey: string; readonly from: string }
  | { readonly kind: 'local-capture' }

/**
 * Une variable **déclarée vide vaut absente**, ici comme dans `parseEnv`.
 *
 * `getEnv` rend la source telle quelle, sans validation ni normalisation, en
 * phase de build et sous `SKIP_ENV_VALIDATION` — les deux seuls chemins pour
 * lesquels cette garde existe. Sans cette normalisation, le `RESEND_API_KEY=`
 * vide que livre `.env.example` s'y lit « clé renseignée » : la branche
 * fournisseur l'emporterait sur la capture explicitement demandée, et la
 * décision ne serait pas celle du schéma (revue de s06, G2).
 */
const declared = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim()

  return trimmed === undefined || trimmed === '' ? undefined : trimmed
}

/**
 * Rend la configuration du mailer, ou lève en nommant les deux variables.
 *
 * La capture locale est un **opt-in, pas un repli** : en faire la conséquence
 * automatique d'une clé absente rendait `{ok:true}` sur un email que personne
 * ne recevrait, en production comme ailleurs, sans qu'aucun appelant puisse le
 * distinguer d'un envoi réussi (revue de s06, F3).
 */
export function resolveMailerConfig(env: Env): MailerConfig {
  const apiKey = declared(env.RESEND_API_KEY)
  const from = declared(env.EMAIL_FROM)

  if (apiKey !== undefined && from !== undefined) {
    return { kind: 'provider', apiKey, from }
  }

  if (declared(env.EMAIL_LOCAL_CAPTURE) === EMAIL_LOCAL_CAPTURE_ENABLED) {
    return { kind: 'local-capture' }
  }

  throw new Error(
    'Aucun mailer configuré : renseignez RESEND_API_KEY (avec EMAIL_FROM) pour envoyer, ' +
      `ou EMAIL_LOCAL_CAPTURE=${EMAIL_LOCAL_CAPTURE_ENABLED} pour capturer les emails dans « ${LOCAL_MAIL_DIRECTORY} » sans rien envoyer.`,
  )
}
