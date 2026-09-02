import { PAYMENTS_LOCAL_MODE_ENABLED, type Env } from '@repo/config'

/**
 * **La règle qui décide du fournisseur de paiement**, isolée de ce qui le
 * construit — même forme que `lib/mailer-config.ts` et `lib/oauth-config.ts`,
 * et pour la même raison : `apps/web/next.config.ts` la réapplique au
 * **démarrage**, sans charger le SDK ni la base pour poser une question à trois
 * variables.
 *
 * Trois états, et il faut en choisir un :
 *
 * | Configuration | Ce qui se passe |
 * |---|---|
 * | `STRIPE_SECRET_KEY` **et** `STRIPE_WEBHOOK_SECRET` | le vrai fournisseur |
 * | `PAYMENTS_LOCAL_MODE=1`, aucune clé | la simulation locale, sans réseau |
 * | rien | l'application **refuse de démarrer**, en nommant les trois variables |
 *
 * Le troisième état est le point : `docs/reliability.md` §2 interdit le repli
 * silencieux. Un déploiement sans clé qui basculerait tout seul en simulation
 * accorderait des abonnements que personne n'a payés, sans que rien ne le dise.
 *
 * **Cette règle n'est appliquée que si le module `billing` est activé.** Un
 * projet qui ne vend rien n'a pas à configurer un fournisseur de paiement — et
 * `pnpm db:migrate` n'encaisse rien non plus.
 */

/**
 * Le secret qui signe les événements **simulés**.
 *
 * Ce n'est pas un secret : il ne protège rien qu'un simulateur, et il ne vaut
 * que dans un processus où `PAYMENTS_LOCAL_MODE=1` a été posé à la main. Il est
 * écrit en clair et nommé pour qu'on ne le confonde jamais avec celui du
 * fournisseur — et il ne porte délibérément pas le préfixe d'un vrai secret de
 * webhook.
 */
export const LOCAL_WEBHOOK_SECRET = 'payments-local-mode-not-a-secret'

export type BillingConfig =
  | { readonly kind: 'provider'; readonly apiKey: string; readonly webhookSecret: string }
  | { readonly kind: 'local'; readonly webhookSecret: string }

/** Une variable déclarée vide vaut absente, ici comme dans `parseEnv`. */
const declared = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim()

  return trimmed === undefined || trimmed === '' ? undefined : trimmed
}

/**
 * Rend la configuration du paiement, ou lève en nommant les variables.
 *
 * La règle est réappliquée ici et pas seulement dans le schéma parce que
 * `getEnv` ne valide rien en phase de build ni sous `SKIP_ENV_VALIDATION` : sur
 * ces chemins, le `STRIPE_SECRET_KEY=` vide que livre `.env.example` se lirait
 * « clé renseignée » (revue de s06, G2).
 */
export function resolveBillingConfig(env: Env): BillingConfig {
  const apiKey = declared(env.STRIPE_SECRET_KEY)
  const webhookSecret = declared(env.STRIPE_WEBHOOK_SECRET)
  const local = declared(env.PAYMENTS_LOCAL_MODE) === PAYMENTS_LOCAL_MODE_ENABLED

  if (apiKey !== undefined && webhookSecret !== undefined) {
    if (local) {
      throw new Error(
        `PAYMENTS_LOCAL_MODE=${PAYMENTS_LOCAL_MODE_ENABLED} est posé en même temps qu’une clé Stripe : ` +
          'choisissez l’un des deux. Le mode local est un opt-in de développement, jamais un repli — ' +
          'sans quoi personne ne peut distinguer un abonnement payé d’un abonnement simulé.',
      )
    }

    return { kind: 'provider', apiKey, webhookSecret }
  }

  if (local) {
    /**
     * **Le drapeau ne s'arme pas en production**, et ce n'est pas de la forme.
     *
     * La simulation accorde un abonnement complet à qui clique, sans paiement.
     * Posée sur un déploiement de production — une variable copiée d'un `.env`
     * de poste suffit —, elle ouvre la porte à tout compte. Le rayon d'action
     * est celui d'`OAUTH_LOCAL_PROVIDER`, dont ce refus est repris.
     *
     * La règle du socle — « jamais déduit de `NODE_ENV` » — reste tenue : le
     * drapeau demeure l'**unique** opt-in, `NODE_ENV` ne l'active jamais, il le
     * **restreint**.
     */
    if (env.NODE_ENV === 'production') {
      throw new Error(
        `PAYMENTS_LOCAL_MODE=${PAYMENTS_LOCAL_MODE_ENABLED} est posé avec NODE_ENV=production : ` +
          'la simulation accorde un abonnement complet sans paiement, à n’importe quel compte. ' +
          'Retirez PAYMENTS_LOCAL_MODE de cet environnement, ou configurez STRIPE_SECRET_KEY et ' +
          'STRIPE_WEBHOOK_SECRET.',
      )
    }

    return { kind: 'local', webhookSecret: LOCAL_WEBHOOK_SECRET }
  }

  throw new Error(
    'Le module de facturation est activé mais aucun fournisseur de paiement n’est configuré : ' +
      'renseignez STRIPE_SECRET_KEY et STRIPE_WEBHOOK_SECRET pour encaisser, ou ' +
      `PAYMENTS_LOCAL_MODE=${PAYMENTS_LOCAL_MODE_ENABLED} pour simuler les paiements en local sans rien encaisser. ` +
      'Couper le module (`pnpm ks toggle billing`) est la troisième réponse valable.',
  )
}
