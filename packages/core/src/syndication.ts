import type { PublicUrlContext } from './module'
import type { ModuleRegistry } from './registry'

/**
 * Plan de site et politique des robots — des fonctions pures.
 *
 * **Elles vivaient dans le `domain` du module `marketing`** (s10) et sont
 * montées ici en s53. La raison est le critère 4 de la story : `app/robots.ts`
 * et `app/sitemap.ts` ne doivent connaître **aucun** module par son nom, et
 * elles les importaient. Ce qu'elles font n'a d'ailleurs jamais rien eu de
 * marketing — des chemins entrent, des URL sortent —, et c'est le socle qui
 * agrège désormais les contributions de tous les modules.
 *
 * Elles ne dépendent de rien : ni Next, ni le module `i18n`, ni `APP_URL`. Le
 * point de composition leur fournit **une façon de construire une URL
 * absolue**, et c'est ce qui les rend éprouvables sans démarrer quoi que ce
 * soit.
 */

/**
 * Une URL publique **dédupliquée**, telle que l'application l'indexe.
 *
 * Même forme que `PublicUrl`, mais **fusionnée** : une seule source — les
 * contributions des modules activés (`publicUrls`) —, dédupliquée par chemin,
 * deux entrées pour la même page étant deux URL pour un moteur. Les entrées de
 * navigation publiques du registre n'en font **pas** partie : voir
 * `indexableUrls` juste en dessous, qui dit pourquoi et sur quelle mesure.
 */
export interface IndexableUrl {
  readonly path: string
  readonly locales: readonly string[]
  readonly lastModified?: string
}

/**
 * Ce que l'application donne à indexer, **dérivé du registre**.
 *
 * **Une seule source : la quinzième clé du contrat** (ADR 054). Un module dit
 * ce qu'il publie ; personne ne le devine à sa place.
 *
 * La recherche de s53 proposait une seconde source — les **entrées de
 * navigation publiques** du registre —, et elle a été mesurée avant d'être
 * écartée. Dans la configuration livrée, cinq entrées sont publiques :
 * `marketing /`, `auth /sign-in`, `blog /blog`, `billing /pricing` et
 * `demo-enabled /api/modules/demo-enabled/items`. Les en déduire aurait publié
 * l'écran de connexion et une route d'API dans le `sitemap.xml` — exactement la
 * divulgation de surface que `docs/security.md` §7 refuse, et que
 * `tests/marketing.test.ts` comme `e2e/marketing.spec.ts` interdisent déjà par
 * leur nom. **`public` est un niveau de protection, pas une décision
 * d'indexation** : une page peut être ouverte à tous et ne pas avoir à figurer
 * dans un index.
 *
 * Un module coupé n'est pas dans le registre : il ne contribue donc rien, et
 * l'absence est obtenue **sans condition** — il n'y a pas de `if (module
 * activé)`, il n'y a rien du tout.
 *
 * L'ordre est celui du graphe des modules. Un chemin contribué deux fois est
 * fusionné : deux entrées pour la même page sont deux URL pour un moteur.
 */
export function indexableUrls(
  registry: ModuleRegistry,
  context: PublicUrlContext,
): readonly IndexableUrl[] {
  const merged = new Map<string, IndexableUrl>()

  for (const url of registry.publicUrls(context)) {
    const seen = merged.get(url.path)

    if (seen === undefined) {
      merged.set(url.path, url)

      continue
    }

    const lastModified = seen.lastModified ?? url.lastModified

    merged.set(url.path, {
      path: url.path,
      locales: [...new Set([...seen.locales, ...url.locales])],
      ...(lastModified === undefined ? {} : { lastModified }),
    })
  }

  return [...merged.values()]
}

/**
 * Un chemin que l'application sert **sous un préfixe de langue**.
 *
 * La règle est celle d'`apps/web/proxy.ts`, qui l'appliquait seul : elle est
 * écrite ici depuis s53 parce qu'un second appelant en a besoin. `publicPath`,
 * lui, préfixe **sans condition** — c'est le piège relevé en revue de s29
 * (constat M3) : une entrée de navigation vers une route d'API produirait
 * `/fr/api/…`, une URL fausse, autorisée pour rien. Tant qu'aucun module n'en
 * déclarait, personne ne pouvait le voir ; la dérivation de `indexableUrls` en
 * fait une possibilité, donc une règle partagée.
 *
 * Quatre cas, dans l'ordre où le `matcher` de Next les écrivait :
 *
 * 1. `/api…` — les routes que le registre monte n'héritent d'aucun préfixe ;
 * 2. `/_next…` — les points d'entrée internes de Next ;
 * 3. `/favicon.ico` ;
 * 4. **un point n'importe où** — `/robots.txt`, `/sitemap.xml`, `/v1.2/page`.
 */
export function carriesLocalePrefix(pathname: string): boolean {
  // Le motif s'appliquait au chemin **sans** sa barre oblique de tête : ses
  // alternatives se lisent donc à partir du premier caractère utile.
  const route = pathname.slice(1)

  return !(
    route.startsWith('api') ||
    route.startsWith('_next') ||
    route.startsWith('favicon.ico') ||
    route.includes('.')
  )
}

export interface SitemapEntry {
  /** L'URL canonique, dans la langue par défaut — ou la seule langue servie de cette page. */
  readonly url: string
  /** La même page dans chaque langue où elle existe, indexée par code de langue. */
  readonly alternates: Readonly<Record<string, string>>
  /** Date de dernière modification, quand la page en porte une. */
  readonly lastModified?: string
}

export interface SitemapInput {
  readonly entries: readonly IndexableUrl[]
  readonly defaultLocale: string
  /** L'URL absolue d'un chemin interne dans une langue. */
  readonly url: (pathname: string, locale: string) => string
}

/**
 * Le plan de site.
 *
 * **La canonique est une langue où la page existe**, jamais la langue par
 * défaut du site : un article traduit en anglais seulement n'a pas d'URL
 * française, et la désigner reviendrait à donner pour canonique une page qui
 * répond 404.
 */
export function sitemapEntries(input: SitemapInput): readonly SitemapEntry[] {
  return input.entries.map((entry) => {
    const canonicalLocale = entry.locales.includes(input.defaultLocale)
      ? input.defaultLocale
      : (entry.locales[0] ?? input.defaultLocale)

    return {
      url: input.url(entry.path, canonicalLocale),
      alternates: Object.fromEntries(
        entry.locales.map((locale) => [locale, input.url(entry.path, locale)]),
      ),
      ...(entry.lastModified === undefined ? {} : { lastModified: entry.lastModified }),
    }
  })
}

export interface RobotsPolicy {
  readonly rules: {
    readonly userAgent: string
    readonly allow?: readonly string[]
    readonly disallow: readonly string[]
  }
  readonly sitemap?: string
}

export interface RobotsInput {
  /** Les URL publiques, telles qu'un robot les verrait. */
  readonly allowed: readonly string[]
  readonly sitemapUrl: string
}

/**
 * Le motif qui n'autorise **que** ce chemin, et rien de ce qui s'ouvre en
 * dessous.
 *
 * Un `robots.txt` se lit **par préfixe** (RFC 9309 §2.2.2) : `Allow: /fr`
 * autorise `/fr/account`, `/fr/sign-in` et `/fr/reset-password?token=…`, et il
 * l'emporte sur `Disallow: /` parce qu'il est plus long. Autrement dit, écrire
 * le chemin public tel quel ouvre toute l'application sous son préfixe —
 * l'inverse exact de ce que cette politique annonce, et un jeton de
 * réinitialisation dans un index public est une fuite.
 *
 * Le `$` est l'ancre de fin de motif, l'un des deux caractères spéciaux que
 * RFC 9309 §2.2.3 impose aux robots de comprendre. Le prix assumé : `/fr/` et
 * `/fr?utm_source=…` ne sont pas autorisés non plus. Ce sont des variantes de
 * la page canonique, que le plan de site n'annonce pas.
 */
const exactly = (pathname: string): string => `${pathname}$`

/**
 * Ce qu'un robot a le droit d'explorer.
 *
 * **Interdire d'abord, autoriser ensuite ce qui est public** : l'inverse —
 * `Allow: /` avec quelques exclusions — laisserait indexer chaque écran ajouté
 * par une story suivante sans que personne ne le décide. Les écrans applicatifs
 * refusent déjà l'accès côté serveur ; les faire figurer dans un index public
 * n'en reste pas moins une divulgation gratuite de la surface de
 * l'application (`docs/security.md` §7).
 *
 * Aucun chemin public : tout est interdit, et **aucun plan de site n'est
 * annoncé**. Annoncer un `sitemap.xml` vide reviendrait à publier une adresse
 * qui ne référence rien.
 *
 * **La bascule que s53 assume** : la liste ne vient plus d'un seul module. Site
 * public coupé et blog activé, elle cesse d'être vide — le plan de site
 * réapparaît donc dans le `robots.txt` là où il était tu. C'est écrit, et
 * `packages/core/src/syndication.test.ts` porte les deux configurations.
 */
export function robotsPolicy(input: RobotsInput): RobotsPolicy {
  if (input.allowed.length === 0) {
    return { rules: { userAgent: '*', disallow: ['/'] } }
  }

  return {
    rules: { userAgent: '*', allow: input.allowed.map(exactly), disallow: ['/'] },
    sitemap: input.sitemapUrl,
  }
}

/** Un motif de `robots.txt`, tel que RFC 9309 §2.2.3 le définit : `*` et `$`. */
const patternMatcher = (pattern: string): RegExp => {
  const anchored = pattern.endsWith('$')
  const body = anchored ? pattern.slice(0, -1) : pattern
  const escaped = body.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*')

  return new RegExp(`^${escaped}${anchored ? '$' : ''}`)
}

/** La longueur du motif le plus long qui corresponde, ou `-1` si aucun ne correspond. */
const longestMatch = (patterns: readonly string[], pathname: string): number =>
  patterns
    .filter((pattern) => patternMatcher(pattern).test(pathname))
    .reduce((longest, pattern) => Math.max(longest, pattern.length), -1)

/**
 * Ce qu'une politique **veut dire**, lue comme un robot la lit.
 *
 * Sans cette lecture, la politique ne peut être éprouvée que sur sa forme —
 * « la liste `allow` contient ce que j'y ai mis » —, et c'est exactement ce qui
 * a laissé passer un `Allow: /fr` ouvrant toute l'application : le test
 * affirmait le défaut. La règle de RFC 9309 §2.2.2 est ici : le motif le plus
 * long l'emporte, l'autorisation gagne à égalité, et ce qu'aucune règle ne
 * couvre est autorisé par défaut.
 *
 * C'est `tests/marketing.test.ts` qui la confronte aux écrans réels de
 * l'application, et `e2e/marketing.spec.ts` au fichier réellement servi.
 */
export function robotsAllows(policy: RobotsPolicy, pathname: string): boolean {
  return (
    longestMatch(policy.rules.allow ?? [], pathname) >=
    longestMatch(policy.rules.disallow, pathname)
  )
}
