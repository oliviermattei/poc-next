import type { twoFactor } from 'better-auth/plugins/two-factor'

/**
 * **Le second facteur sur les trois voies d'entrée**, et pas seulement sur le
 * mot de passe (correctif C2 de `docs/reviews/s13-two-factor.md`).
 *
 * ## Ce qui n'allait pas
 *
 * Le crochet `after` du greffon `two-factor` porte un `matcher` fermé :
 *
 * ```js
 * matcher(context) {
 *   return context.path === "/sign-in/email"
 *     || context.path === "/sign-in/username"
 *     || context.path === "/sign-in/phone-number";
 * }
 * ```
 *
 * L'application en expose trois autres qui ouvrent une session : le **magic
 * link** (`/magic-link/verify`) et les **rappels de fournisseur**
 * (`/callback/:id`). Mesuré avant ce fichier : sur un compte au second facteur
 * confirmé, les deux ouvraient une session sans qu'aucun code ne soit demandé,
 * et `/sign-in` propose le magic link juste sous le formulaire de mot de passe.
 * Une protection qu'un bouton voisin ignore ne protège pas.
 *
 * ## La propriété tenue, et où elle est tenue
 *
 * *Une session ouverte sur un compte à second facteur actif n'existe pas tant
 * que le second facteur n'a pas été présenté* — quelle que soit la voie. Elle
 * est tenue **côté serveur**, au moment où la session est créée : le crochet
 * détruit la session que la bibliothèque vient de poser, efface son cookie, et
 * ouvre un défi à la place. Il n'y a donc aucune session « à moitié
 * authentifiée » à refuser en aval, et aucune route protégée à réviser.
 *
 * ## Une liste d'exemptions, jamais une liste d'inclusions
 *
 * Première forme livrée, et **corrigée** (revue s13, C11) : le `matcher`
 * recevait deux chemins de plus, écrits à la main. Une liste d'inclusions
 * échoue **ouvert** — aucune commande ne rougissait le jour où une quatrième
 * voie de connexion apparaissait, et s14 en monte une
 * (`/passkey/verify-authentication`). Le trou se serait rouvert en silence,
 * sous une suite verte.
 *
 * Le crochet vaut donc **partout**, et ce fichier n'énumère que les chemins
 * **exemptés**. La forme inverse échoue *fermée* : un point d'entrée qui aurait
 * dû être exempté et ne l'est pas se voit poser un défi — visible tout de
 * suite, jamais silencieux. Une liste d'exemptions se relit ; une liste
 * d'inclusions s'oublie.
 *
 * L'élargissement ne coûte rien aux autres chemins : le handler du greffon sort
 * de lui-même quand la requête n'a pas créé de session ou que le compte n'est
 * pas protégé (`index.mjs` : `if (!data) return; if (!data?.user.twoFactorEnabled) return;`).
 *
 * ## Pourquoi reprendre le handler plutôt que le réécrire
 *
 * Le handler du greffon est **repris tel quel** : c'est lui qui supprime la
 * session, pose le cookie de défi signé, écrit les deux lignes de vérification
 * (le défi et son compteur de tentatives) et énumère les facteurs du compte.
 * Le recopier ferait diverger deux écritures du même protocole au premier
 * changement de version — et surtout, la vérification qui suit passerait alors
 * par un défi que la bibliothèque ne reconnaîtrait pas. Seul le `matcher`
 * change.
 *
 * Conséquence voulue : la vérification qui suit emprunte la branche « connexion »
 * de `verifyTwoFactor` — donc le budget de cinq essais par défi
 * (`beginAttempt(5)`) et le verrouillage par compte s'appliquent, exactement
 * comme après un mot de passe. Laisser au contraire la session s'ouvrir puis
 * la marquer « en attente » aurait ouvert une devinette **sans compteur** :
 * cette branche-là n'arme ni `beginAttempt`, ni `accountLockout`.
 *
 * ## Ce que ce fichier suppose du paquet installé (1.7.2)
 *
 * Trois faits, vérifiés un par un, et qu'une montée de version doit rouvrir :
 *
 * 1. le greffon expose **un** crochet `after`, dont le `handler` ne lit pas le
 *    chemin de la requête — il ne lit que `ctx.context.newSession` ;
 * 2. `/magic-link/verify` (`plugins/magic-link/index.mjs:184`) et
 *    `/callback/:id` (`api/routes/callback.mjs:250`) appellent tous deux
 *    `setSessionCookie` **avant** de lancer leur redirection, et
 *    `setSessionCookie` pose `ctx.context.newSession` (`cookies/index.mjs:179`) ;
 * 3. le `path` que reçoit le `matcher` est celui de la **déclaration** de
 *    l'endpoint (`api/dispatch.mjs`, `path: endpoint.path`), donc le segment
 *    dynamique n'est pas résolu : `/callback/:id`, jamais `/callback/github`.
 *    C'est aussi vrai d'un appel direct `auth.api.*`, qui passe par le même
 *    répartiteur (`api/to-auth-endpoints.mjs`) — d'où `/get-session` et
 *    `/change-password` dans les exemptions ci-dessous.
 *
 * Si l'un cède, les deux cas « le magic link / le rappel de fournisseur
 * n'ouvre pas de session sur un compte protégé » de `tests/auth.test.ts`
 * rougissent.
 */

type TwoFactorPlugin = ReturnType<typeof twoFactor>
type AfterHook = NonNullable<NonNullable<TwoFactorPlugin['hooks']>['after']>[number]
type HookContext = Parameters<AfterHook['matcher']>[0]

/**
 * **Les seuls chemins qui ont le droit de poser une session sans défi**, et la
 * raison de chacun. Tout le reste passe par le crochet.
 *
 * Ce sont les chemins de la bibliothèque, pas ceux du module : ce que le
 * répartiteur monte en `/auth/two-factor/verify` arrive ici sous le nom que la
 * bibliothèque lui donne.
 *
 * Deux familles, et rien d'autre :
 *
 * 1. **la vérification du second facteur elle-même** — lui poser un défi
 *    bouclerait sans fin, puisque c'est elle qui les résout. Les trois points
 *    d'entrée du greffon sont exemptés ensemble : `/two-factor/verify-otp`
 *    n'est pas monté aujourd'hui (`otpOptions` absent), il appartient à la même
 *    famille et le jour où il l'est, il ne doit pas se refuser lui-même ;
 * 2. **la rotation de la session d'un appelant déjà authentifié**, mesurée sur
 *    les deux points d'entrée que le module appelle en direct
 *    (`better-auth-service.ts`, `auth.api.*`) : `/get-session` renouvelle le
 *    cookie passé `updateAge` (`api/routes/session.mjs:204`, un jour ici) et
 *    `/change-password` fait tourner la session après la preuve du mot de passe
 *    (`api/routes/update-user.mjs:185`). Les deux appellent `setSessionCookie`,
 *    donc posent `newSession` : sans exemption, le crochet détruirait la
 *    session d'un compte protégé au premier rafraîchissement, et le seul
 *    symptôme serait une déconnexion inexpliquée au bout d'un jour.
 *
 * `/update-user` et `/change-email` font tourner la session eux aussi, et ne
 * sont **pas** exemptés : le module ne les monte pas — ses routes de changement
 * de nom et d'adresse passent par ses propres cas d'usage. Les monter un jour
 * sans les exempter donnerait un défi de trop, visible immédiatement ; c'est le
 * sens de l'échec qu'on veut.
 */
export const TWO_FACTOR_CHALLENGE_EXEMPT_PATHS = {
  '/two-factor/verify-totp': 'la vérification du second facteur elle-même',
  '/two-factor/verify-backup-code': 'la vérification du second facteur elle-même',
  '/two-factor/verify-otp': 'la vérification du second facteur elle-même (non monté)',
  '/get-session': 'renouvellement du cookie d’une session déjà authentifiée',
  '/change-password': 'rotation de session après la preuve du mot de passe courant',
} as const

/**
 * Le moyen de connexion interrompu, tel que le **journal** le nomme.
 *
 * `other` n'est pas un trou : c'est l'ordre voulu. Une voie de connexion neuve
 * est couverte par la garde **avant** d'être nommée ici — la sécurité ne dépend
 * pas d'une table de libellés, et un événement au nom générique vaut mieux
 * qu'une session ouverte.
 */
export type ChallengedSignInMethod = 'magic_link' | 'oauth' | 'other'

/**
 * Ce que le journal écrit pour un chemin donné, `null` quand la route du module
 * le journalise déjà.
 *
 * `/sign-in/email` est le seul cas : sa route relit l'acteur par l'adresse — la
 * réponse ne porte plus rien qui l'identifie — et écrit
 * `auth.two_factor_challenged` avec `method: 'password'`. Le journaliser une
 * seconde fois ici en ferait deux.
 */
const CHALLENGE_JOURNAL: Readonly<Record<string, ChallengedSignInMethod | null>> = {
  '/sign-in/email': null,
  '/magic-link/verify': 'magic_link',
  '/callback/:id': 'oauth',
}

const challengedMethod = (path: string | undefined): ChallengedSignInMethod | null =>
  path !== undefined && path in CHALLENGE_JOURNAL ? (CHALLENGE_JOURNAL[path] ?? null) : 'other'

/**
 * Le chemin est-il exempté de défi ?
 *
 * Un chemin **inconnu** ne l'est pas : la garde échoue fermée, jamais ouverte.
 */
const isExempt = (path: string | undefined): boolean =>
  path !== undefined && path in TWO_FACTOR_CHALLENGE_EXEMPT_PATHS

interface TwoFactorChallengeOptions {
  /**
   * Le compte dont la connexion vient d'être interrompue.
   *
   * **C'est le seul endroit qui le connaît** : la réponse ne porte plus rien
   * qui l'identifie — la session vient d'être détruite, et le cookie de défi
   * est signé. Sans ce rappel, `docs/security.md` §7 recevrait un événement de
   * connexion sans acteur sur deux des trois voies.
   */
  readonly onChallenge: (input: {
    readonly userId: string
    readonly method: ChallengedSignInMethod
  }) => void
}

/** Le greffon, avec son défi posé sur toutes les voies qui ouvrent une session. */
export function withTwoFactorOnEverySignIn(
  plugin: TwoFactorPlugin,
  options: TwoFactorChallengeOptions,
): TwoFactorPlugin {
  const after = plugin.hooks?.after ?? []

  return {
    ...plugin,
    hooks: {
      ...plugin.hooks,
      after: after.map((hook) => ({
        ...hook,
        matcher: (context: HookContext): boolean => !isExempt(context.path),
        handler: (async (context: HookContext) => {
          const method = challengedMethod(context.path)
          // Lu **avant** le handler : c'est lui qui remet `newSession` à
          // `null` après avoir supprimé la session.
          const userId = context.context.newSession?.user.id ?? null
          const outcome = await hook.handler(context)

          if (method !== null && userId !== null && context.context.newSession === null) {
            options.onChallenge({ userId, method })
          }

          return outcome
        }) as AfterHook['handler'],
      })),
    },
  }
}
