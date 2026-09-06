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

/* ------------------------------------------------------------------------- *
 * Le flux — **RSS 2.0**, écrit ici et nulle part ailleurs (s31, ADR 065).
 *
 * Il vivait dans le `domain` du module `blog` (s53), qui était le seul à en
 * avoir un. Le changelog en réclame un aussi, et le laisser là-bas lui aurait
 * imposé `requires: ['blog']` : un produit qui coupe le blog aurait perdu ses
 * nouveautés. Il est monté ici, à côté du plan de site et de la politique des
 * robots — c'est la même famille, la syndication du contenu public, et
 * `@repo/core` est ce que tout module a déjà le droit d'importer.
 *
 * Pure : des entrées entrent, un document sort. Aucune lecture de disque,
 * aucune URL absolue construite ici — l'appelant fournit les liens, comme le
 * plan de site reçoit les siens.
 *
 * **Pourquoi RSS 2.0 et pas Atom** : c'est le format qu'un lecteur de flux, un
 * agrégateur ou une lettre d'information sait consommer sans exception, et le
 * seul que les stories nomment. Un second format serait une seconde surface à
 * tenir.
 *
 * **Pourquoi aucune bibliothèque de génération** : le document tient en une
 * douzaine de balises, et une dépendance d'exécution de plus en est une de plus
 * dans l'image de production. Le prix de ce choix est l'échappement, qui est la
 * seule chose qu'un générateur ferait mieux — il est donc mesuré ici, et le
 * document **servi** est passé à un analyseur de flux tiers
 * (`@rowanmanning/feed-parser`) par `tests/blog.test.ts` et
 * `tests/changelog.test.ts`.
 *
 * **Ce que cette mesure prouve, et ce qu'elle ne prouve pas.** L'analyseur se
 * décrit lui-même comme *resilient* : il **lève** sur un document qui n'est pas
 * un flux, et il **accepte** un `<channel>` sans titre, sans lien et sans
 * description. Il établit donc « analysable comme flux », pas « valide au sens
 * d'un validateur » — le dépôt n'embarque aucun validateur, et cette limite est
 * elle-même un cas de `tests/blog.test.ts` pour qu'aucune relecture ne la
 * regonfle. La conformité au format, elle, se vérifie en lisant la
 * spécification : c'est ce qui a fait choisir `dc:creator` ci-dessous.
 * ------------------------------------------------------------------------- */

export interface FeedItem {
  readonly title: string
  readonly description: string
  /** L'URL absolue de l'entrée, dans la langue du flux. */
  readonly url: string
  /** Date de publication, `AAAA-MM-JJ`. */
  readonly date: string
  /**
   * Le nom d'affichage de l'auteur, **facultatif**.
   *
   * Un article de blog en a un ; une entrée de changelog n'en a pas — elle
   * appartient à une version du produit, pas à quelqu'un. Absent, aucune balise
   * n'est écrite : un `<dc:creator>` vide serait une signature attribuée à
   * personne, que les agrégateurs affichent telle quelle.
   */
  readonly author?: string
}

export interface FeedInput {
  readonly title: string
  readonly description: string
  readonly locale: string
  /** L'URL absolue de la page correspondante, dans la langue du flux. */
  readonly siteUrl: string
  /** L'URL absolue du flux lui-même : RSS demande qu'il se désigne (`atom:link`). */
  readonly feedUrl: string
  readonly items: readonly FeedItem[]
}

/**
 * L'échappement XML, appliqué à **toute** valeur du document.
 *
 * Les cinq entités prédéfinies de XML 1.0 §4.6. Un titre est du texte libre
 * écrit dans un fichier `.mdx` : un `&` non échappé suffit à rendre le document
 * illisible pour tout analyseur, et un `<` y ouvrirait une balise.
 */
const escapeXml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')

/**
 * La date au format que RSS 2.0 exige (RFC 822, via RFC 1123).
 *
 * `toUTCString()` de la plateforme rend exactement cette forme. La date d'une
 * entrée est un **jour de calendrier** : elle est lue à midi UTC pour qu'aucun
 * décalage horaire de lecteur ne la fasse basculer sur la veille.
 */
const rfc822 = (date: string): string => new Date(`${date}T12:00:00Z`).toUTCString()

/**
 * Le flux, entrées du plus récent au plus ancien.
 *
 * L'ordre n'est pas cosmétique : un lecteur de flux affiche le document tel
 * qu'il le reçoit, et un flux qui commence par l'entrée la plus ancienne montre
 * du vieux contenu en tête à chaque visite.
 */
export function renderFeed(input: FeedInput): string {
  const items = [...input.items]
    .sort((left, right) => right.date.localeCompare(left.date))
    .map((item) =>
      [
        '    <item>',
        `      <title>${escapeXml(item.title)}</title>`,
        `      <link>${escapeXml(item.url)}</link>`,
        // `isPermaLink="true"` : l'identifiant **est** l'adresse. Un lecteur
        // dédoublonne dessus, et une valeur qui changerait d'une lecture à
        // l'autre republierait chaque entrée à chaque fois.
        `      <guid isPermaLink="true">${escapeXml(item.url)}</guid>`,
        `      <description>${escapeXml(item.description)}</description>`,
        // **`dc:creator`, et non `<author>`** : RSS 2.0 définit
        // `<item><author>` comme l'**adresse email** de l'auteur
        // (`<author>lawyer@boyer.net (Lawyer Boyer)</author>`), et un nom nu y
        // vaut `InvalidContact` au validateur de flux du W3C. Le frontmatter
        // d'un article porte un nom d'affichage ; la seule façon de tenir
        // `<author>` serait d'inventer une adresse, c'est-à-dire de publier une
        // boîte aux lettres dans un document que des robots moissonnent.
        // `dc:creator` est la convention prévue pour un nom seul, et son espace
        // de noms est déclaré sur `<rss>`.
        ...(item.author === undefined
          ? []
          : [`      <dc:creator>${escapeXml(item.author)}</dc:creator>`]),
        `      <pubDate>${rfc822(item.date)}</pubDate>`,
        '    </item>',
      ].join('\n'),
    )

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">',
    '  <channel>',
    `    <title>${escapeXml(input.title)}</title>`,
    `    <link>${escapeXml(input.siteUrl)}</link>`,
    `    <description>${escapeXml(input.description)}</description>`,
    `    <language>${escapeXml(input.locale)}</language>`,
    `    <atom:link href="${escapeXml(input.feedUrl)}" rel="self" type="application/rss+xml"/>`,
    ...items,
    '  </channel>',
    '</rss>',
    '',
  ].join('\n')
}
