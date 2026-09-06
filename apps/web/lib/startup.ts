import { assertStartupEnv } from '@repo/config'

import { enabledModules } from '../../../config/features'
import { contentSecurityPolicySources } from '../../../config/security'
import { superadminWarningFor } from './admin'
import { assertAnalyticsIsReachable, resolveAnalyticsConfig } from './analytics-config'
import { resolveAuthConfig } from './auth-config'
import { billingCatalogue } from './billing-catalogue'
import { resolveBillingConfig } from './billing-config'
import { assertFeatureGates } from './feature-gates'
import { assertJobsConfiguration } from './jobs'
import { resolveMailerConfig } from './mailer-config'
import { resolveOAuthConfig } from './oauth-config'
import { assertRateLimitConfiguration } from './rate-limit'
import { resolveStorageConfig } from './storage-config'

/** Le module de facturation est-il activé ? La configuration décide, pas un `if` épars. */
const billingEnabled = (enabledModules as readonly string[]).includes('billing')

export interface AssertStartupConfigurationOptions {
  /** Phase transmise par Next à `next.config.ts`. Absente ailleurs. */
  readonly phase?: string
}

/**
 * **Tout ce que cette application vérifie avant de servir une requête**, en un
 * seul endroit, appelé par ses **deux** points de démarrage.
 *
 * Deux, et pas un, depuis que le dépôt produit une image de production (s27) :
 *
 * - `next.config.ts`, chargé par `next dev` et par `next build`. Il reçoit la
 *   phase, ce qui laisse passer le build ;
 * - `instrumentation.ts`, appelé une fois au démarrage du serveur — et **le
 *   seul des deux que la sortie autonome atteigne** : `output: 'standalone'`
 *   sérialise la configuration dans `server.js`, si bien que `next.config.ts`
 *   n'est plus exécuté au démarrage. Sans ce second point, l'image démarrerait
 *   sans rien valider, et `/api/health` répondrait 503 pour toujours — mesuré
 *   sur la première image de s27, et déjà écrit comme frontière connue dans
 *   `packages/config/src/env.ts` (constats N15/N16 de s01).
 *
 * Lève une `EnvValidationError` nommant chaque variable fautive.
 */
export function assertStartupConfiguration(
  options: AssertStartupConfigurationOptions = {},
): void {
  const env = assertStartupEnv(options)

  // **Le catalogue d'offres, avant tout le reste et sans condition de phase.**
  //
  // Il ne lit **aucune** variable : c'est du code, pas de l'environnement. Les
  // deux échappatoires qui suivent — la phase de build et `SKIP_ENV_VALIDATION`
  // — existent pour des variables d'exécution absentes, et rien ne justifie
  // qu'un artefact se construise sur une configuration que le démarrage
  // refusera. Sans cet appel, une offre malformée ne se voyait qu'à la première
  // requête qui construisait le service — et cette requête pouvait être le
  // webhook public, qui répondait alors 500 (constat F2 de la revue de s19).
  //
  // Comme la garde du paiement, elle ne vaut que si le module est activé : un
  // projet qui ne vend rien n'a pas de catalogue à tenir.
  if (billingEnabled) {
    billingCatalogue()
  }

  // **Les fonctionnalités réservées aux offres payantes** (s21, ADR 043), et
  // pour la même raison, sans condition de phase : deux fichiers de
  // configuration, aucune variable d'environnement.
  //
  // Deux fautes y sont refusées, et elles ne se ressemblent pas : une
  // fonctionnalité qui nomme une offre absente du catalogue serait fermée pour
  // toujours à qui a payé ; une route qui réserve une fonctionnalité que
  // `config/gating.ts` ne déclare pas serait refusée à **tout le monde**, en
  // silence — l'inverse exact du trou de s17, où une action absente de la
  // matrice n'était refusée par personne.
  //
  // La garde vaut dans les **deux** configurations de modules : couper la
  // facturation retire seulement la confrontation au catalogue, qui n'aurait
  // alors plus de sens.
  assertFeatureGates()

  // **Les seuils de limitation de débit** (s28, ADR 050), sans condition de
  // phase et pour la même raison : c'est un fichier de configuration, donc du
  // code, et aucune variable d'environnement n'y entre. Trois fautes y sont
  // refusées : un seuil nul ou négatif — qui n'est pas « aucune limite », il
  // n'existe aucun moyen de désactiver la limitation —, une route qui nomme une
  // politique inconnue — elle serait servie sans limite —, et un captcha activé
  // dont l'origine n'est pas déclarée dans la politique de sécurité du contenu,
  // que le navigateur bloquerait en fermant le formulaire sans un mot.
  assertRateLimitConfiguration()

  // **Les tâches de fond** (s33), sans condition de phase pour sa moitié qui ne
  // lit aucune variable : le **plancher** de l'ordonnanceur — au moins une tâche
  // déclarée, aucun doublon, chaque expression cron lisible.
  //
  // **Ce que cet appel-ci tient tout seul, et rien de plus** : la **phase de
  // construction**, où l'appel d'en bas n'est jamais atteint. Au démarrage, ce
  // dernier rejoue le même plancher — la seconde revue de s33 a mesuré que
  // neutraliser cette ligne laissait la suite verte, ce qui était exact. Sa
  // contribution propre est donc qu'un `pnpm build` refuse une expression cron
  // illisible plutôt que de livrer une image dont l'ordonnanceur ne démarrera
  // pas, et c'est ce que `tests/env-wiring.test.ts` mesure désormais (« refuse
  // la construction sur une expression cron illisible »).
  //
  // Module coupé, elle **journalise le repli** au lieu de refuser : l'émission
  // s'exécute alors dans la requête appelante, et les tâches planifiées ne
  // s'exécutent pas (critère 8).
  assertJobsConfiguration()

  if (env === undefined) {
    return
  }

  // **L'administration de plateforme avertit, elle ne refuse pas** (s37a,
  // critère 3), et c'est la seule garde de ce fichier qui laisse démarrer.
  // Une plateforme sans superadmin **doit** pouvoir démarrer : la variable
  // nomme une adresse dont le compte n'existe pas encore sur une base vierge,
  // et refuser rendrait la désignation impossible. Le back-office, lui, répond
  // 404 à tout le monde tant que personne ne l'administre.
  const superadminWarning = superadminWarningFor(env)

  if (superadminWarning !== null) {
    console.warn(superadminWarning)
  }

  resolveMailerConfig(env)
  // Même règle pour l'authentification : cette application refuse de démarrer
  // sans secret de session ni URL publique, plutôt que de servir des liens de
  // vérification qui ne mènent nulle part.
  resolveAuthConfig(env)
  // Et pour les fournisseurs externes : **aucun** est un état valide — les
  // boutons disparaissent —, mais une paire à moitié renseignée arrête le
  // démarrage en nommant la variable absente, plutôt que d'échouer au premier
  // clic en production (`docs/security.md` §5).
  resolveOAuthConfig(env)
  // Et pour le stockage — **mais seulement si le module est activé**. C'est
  // la différence avec les trois précédents : le mailer et l'authentification
  // sont exigés de toute application qui démarre, le stockage ne l'est que
  // d'une application qui en a un. Un dépôt qui coupe le module n'a aucune
  // variable à renseigner (critère 7 de s18), et la liste est lue dans
  // `config/features.ts` plutôt que dans le registre : la question est « ce
  // module est-il activé ? », pas « le registre est-il cohérent ? », et
  // construire le registre ici chargerait chaque module pour y répondre.
  if ((enabledModules as readonly string[]).includes('storage')) {
    resolveStorageConfig(env)
  }

  // **Et pour le paiement — mais seulement si le module est activé.** Un
  // projet qui ne vend rien n'a pas à configurer un fournisseur de paiement,
  // et c'est la seule des quatre gardes qui dépende de la configuration des
  // modules. Sans clé et sans drapeau, l'application refuse de démarrer en
  // nommant les trois variables : `docs/reliability.md` §2 interdit le repli
  // silencieux, qui accorderait ici des abonnements que personne n'a payés.
  if (billingEnabled) {
    resolveBillingConfig(env)
  }

  // Et pour les tâches — **mais seulement si le module est activé**, comme le
  // stockage et le paiement. Sans clé et sans drapeau, l'application refuse de
  // démarrer en nommant les trois variables : `docs/reliability.md` §2 interdit
  // le repli silencieux, qui exécuterait ici deux fois chaque échéance dès la
  // seconde instance.
  assertJobsConfiguration(env)

  // **Et pour l'analytique** (s39) — seulement si le module est activé, comme
  // le stockage, le paiement et les tâches. Aucune clé est un état valide, et
  // c'est même l'état livré : rien n'est mesuré et aucun appel ne part. Ce qui
  // refuse, c'est une clé configurée dont l'**origine** n'est pas déclarée à la
  // politique de sécurité du contenu : le script se chargerait (le nonce
  // l'autorise) et chacun de ses appels serait bloqué par le navigateur, si bien
  // que le produit aurait l'air de mesurer sans rien mesurer. Même arbitrage que
  // le captcha de s28, dont `config/security.ts` écrit le motif.
  //
  // **Atteinte depuis le démarrage, et mesurée** : la revue a trouvé que retirer
  // cet appel laissait 2 605 cas verts — le défaut exact de s33, dont la leçon
  // était écrite trois lignes plus bas dans `tests/env-wiring.test.ts`. Ce
  // fichier-là porte désormais le cas, par `loadNextConfig()`, avec son plancher
  // (aucune clé ne refuse rien).
  if ((enabledModules as readonly string[]).includes('analytics')) {
    assertAnalyticsIsReachable(resolveAnalyticsConfig(env), {
      connect: contentSecurityPolicySources.connect,
      img: contentSecurityPolicySources.img,
    })
  }
}

/**
 * La même garde, mais qui **sort du processus** au lieu de lever.
 *
 * Appelée par `instrumentation.ts`, c'est-à-dire au démarrage du serveur.
 * Mesuré : quand `register` lève, Next journalise « Failed to prepare server »
 * puis un `unhandledRejection`, et **laisse le processus vivant** — il répond
 * alors 500 sur chaque requête. Un conteneur dans cet état est « running » pour
 * son orchestrateur : un déploiement cassé qui a l'air vert, ce que
 * `docs/reliability.md` interdit. Le code de sortie est le seul signal qu'un
 * orchestrateur lit.
 *
 * Elle vit ici, et non dans `instrumentation.ts`, parce que Next compile ce
 * fichier-là **aussi pour le runtime edge** : `process.exit` y est une API Node
 * absente, et sa seule présence lexicale fait échouer la compilation du paquet
 * edge (« Ecmascript file had an error », mesuré). `instrumentation.ts`
 * n'importe donc ce module que dynamiquement, derrière sa garde de runtime.
 */
export function refuseStartupOnInvalidConfiguration(): void {
  try {
    assertStartupConfiguration()
  } catch (error) {
    console.error(
      `Démarrage refusé : ${error instanceof Error ? error.message : String(error)}`,
    )
    process.exit(1)
  }
}
