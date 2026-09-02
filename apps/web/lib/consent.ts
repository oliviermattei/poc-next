import { CONSENT_SCRIPT_PROBE_ENABLED, getEnv, type Env } from '@repo/config'
import {
  CONSENT_COOKIE,
  CONSENT_SCREEN_PATH,
  consentModule,
  declaredCategories,
  decodeConsentCookie,
  FOOTER_LINK_KEY,
  provideConsent,
  resolveConsentState,
  type ConsentCategory,
  type ConsentState,
  type NonEssentialScript,
} from '@repo/module-consent'
import { cookies } from 'next/headers'

import { moduleRegistry } from './module-registry'

/**
 * Le point de composition du consentement — le septième du même modèle, après
 * le mailer, l'authentification, l'i18n, le site public, les organisations et
 * le stockage.
 *
 * C'est **le seul fichier de l'application qui regarde si ce module est
 * activé**, et **le registre des scripts non essentiels**. Ailleurs — le shell,
 * l'écran de préférences, la carte de compte — on lit `consent`, dont la forme
 * est la même dans les deux états. (Les écrans importent le barril du module
 * pour ses **clés de traduction**, comme ils le font déjà pour `marketing` ;
 * `lib/organizations.ts` en importe le segment réservé. Ce sont des constantes,
 * pas une décision sur l'état du module.)
 *
 * | | module activé | module coupé |
 * |---|---|---|
 * | `/cookies` | l'écran | **404** |
 * | bannière | selon les scripts déclarés | **jamais** |
 * | scripts injectés | ceux dont la catégorie est accordée | **aucun** |
 * | cookie `app_consent` | posé au choix du visiteur | jamais posé |
 *
 * **C'est ici que s39 branchera PostHog**, et nulle part ailleurs : trois
 * lignes de plus dans `resolveNonEssentialScripts`, conditionnées à
 * l'activation du module d'analytique, exactement comme `lib/marketing.ts`
 * conditionne le site public. Le module `consent`, lui, ne connaîtra jamais de
 * fournisseur.
 */

/**
 * Les deux scripts **de démonstration**, un par catégorie.
 *
 * Ils sont servis par l'application (`/api/consent-probe/<id>`), et c'est le
 * **nonce** posé par `ConsentScripts` qui les autorise, pas leur origine : la
 * politique livrée porte `'strict-dynamic'`, qui fait ignorer `'self'` et toute
 * source d'hôte à un navigateur CSP 3 (ADR 036, mesuré sous le build de
 * production). Un script réellement tiers n'a donc **rien** à ajouter au champ
 * `script` de `config/security.ts` pour un navigateur CSP 3 : ajouter sa ligne ici
 * suffit à le charger. La source d'hôte reste le **repli** des navigateurs CSP 2
 * — Safari avant 15.4 —, qui ignorent `'strict-dynamic'` : un produit qui les
 * vise doit encore la déclarer. `apps/web/lib/security-headers.ts` porte cette
 * nuance, et `connect` comme `img` restent à déclarer dans tous les cas,
 * et c'est le geste d'exploitation de s39. Ce qu'il faudra en revanche
 * déclarer, `'strict-dynamic'` ne valant que pour `script-src` : les origines
 * que le fournisseur appelle, champs `connect` et `img`. La règle est écrite
 * dans `packages/modules/consent/AGENTS.md`.
 */
export const CONSENT_PROBE_PATH = '/api/consent-probe'

const PROBE_SCRIPTS: readonly NonEssentialScript[] = [
  {
    id: 'demo-analytics',
    category: 'analytics',
    src: `${CONSENT_PROBE_PATH}/demo-analytics`,
  },
  {
    id: 'demo-advertising',
    category: 'advertising',
    src: `${CONSENT_PROBE_PATH}/demo-advertising`,
  },
]

/** L'identifiant d'un script de démonstration existe-t-il ? Zod ne le fait pas : la liste le fait. */
export const probeScriptOf = (id: string): NonEssentialScript | null =>
  PROBE_SCRIPTS.find((script) => script.id === id) ?? null

/**
 * Le drapeau est-il posé ? **La règle**, isolée de ce qui la lit, comme
 * `lib/storage-config.ts` : elle se prouve sans manipuler l'environnement du
 * processus de test.
 *
 * Une variable déclarée vide vaut absente, ici comme dans `parseEnv` : `getEnv`
 * rend la source telle quelle en phase de build et sous `SKIP_ENV_VALIDATION`,
 * et le `CONSENT_SCRIPT_PROBE=` de `.env.example` s'y lirait sinon « drapeau
 * posé » (constat G2 de la revue de s06, transposé).
 */
export const probeEnabled = (env: Env): boolean =>
  env.CONSENT_SCRIPT_PROBE?.trim() === CONSENT_SCRIPT_PROBE_ENABLED

/**
 * **Le registre** : les scripts non essentiels que ce déploiement déclare.
 *
 * Vide dans l'état livré du boilerplate — aucun script tiers n'y est livré. Le
 * module est alors inerte par construction : aucune bannière, aucun cookie,
 * rien d'injecté.
 */
export function resolveNonEssentialScripts(env: Env): readonly NonEssentialScript[] {
  return probeEnabled(env) ? PROBE_SCRIPTS : []
}

export interface ConsentFeature {
  /** Le module est-il monté ? **Une donnée**, lue par l'écran pour décider s'il existe. */
  readonly available: boolean
  /** Les scripts non essentiels déclarés. Vide module coupé. */
  readonly scripts: readonly NonEssentialScript[]
  /** Les catégories que ces scripts déclarent, dans l'ordre du produit. */
  readonly categories: readonly ConsentCategory[]
  /** Donne au module sa liste, **avant** qu'une de ses routes ne soit servie. */
  readonly prepare: () => void
}

const mounted = moduleRegistry.moduleIds.includes(consentModule.id)

/**
 * La liste, résolue **à la première lecture** et pas à l'import.
 *
 * `getEnv()` valide tout le contrat d'environnement et lève si `DATABASE_URL`
 * manque : la lire à l'import ferait échouer le seul fait de charger ce fichier
 * dans un processus qui n'a pas de base — `pnpm build` en est un. Même
 * arbitrage que `lib/storage.ts`, dont le montage est lui aussi différé.
 */
let cachedScripts: readonly NonEssentialScript[] | null = null

const declaredScripts = (): readonly NonEssentialScript[] => {
  if (!mounted) {
    return []
  }

  cachedScripts ??= resolveNonEssentialScripts(getEnv())

  return cachedScripts
}

export const consent: ConsentFeature = {
  available: mounted,
  get scripts() {
    return declaredScripts()
  },
  get categories() {
    return declaredCategories(declaredScripts())
  },
  prepare: () => {
    if (mounted) {
      provideConsent(() => ({ scripts: declaredScripts() }))
    }
  },
}

/** Un lien de pied de page, dans la forme que le module `marketing` accepte. */
export interface ConsentFooterLink {
  readonly key: string
  readonly href: string
  readonly label: string
}

/**
 * **Le premier point d'accès** : le lien du pied de page du site public.
 *
 * Il est construit ici — donc du côté du socle — et **donné** au module
 * `marketing`, qui ne sait pas ce qu'est le consentement. L'inverse (déclarer
 * la page dans `config/marketing.ts`) ferait disparaître ce point d'accès avec
 * le site public, c'est-à-dire exactement la non-conformité relevée par le
 * finding F57. Le second point d'accès, lui, vit dans les paramètres de compte
 * et ne dépend d'aucun module optionnel.
 */
export function consentFooterLinks(t: (key: string) => string): readonly ConsentFooterLink[] {
  return consent.available
    ? [{ key: 'consent', href: CONSENT_SCREEN_PATH, label: t(FOOTER_LINK_KEY) }]
    : []
}

/**
 * L'état du consentement **de cette requête**.
 *
 * Il se lit dans le cookie du visiteur, jamais dans un compte : un visiteur
 * anonyme a exactement le même droit qu'un utilisateur connecté, et c'est la
 * moitié de la conformité (ADR 035). Aucune connexion à la base n'est ouverte —
 * `tests/marketing.test.ts` compte celles que le rendu du shell provoque.
 */
export async function currentConsent(): Promise<ConsentState> {
  const jar = await cookies()

  return resolveConsentState(consent.scripts, decodeConsentCookie(jar.get(CONSENT_COOKIE)?.value))
}
