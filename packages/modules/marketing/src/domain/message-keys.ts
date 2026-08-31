import { qualifyMessageKey } from '@repo/core'

import {
  MARKETING_MODULE_ID,
  isItemised,
  type MarketingConfiguration,
  type MarketingLegalDocument,
  type MarketingSection,
} from './marketing-config'

/**
 * **Toutes** les clés de traduction du module, dérivées ici et nulle part
 * ailleurs.
 *
 * Deux raisons, et les deux sont mesurées :
 *
 * 1. Les clés du site public sont **composées**
 *    (`marketing.section.<id>.title`), donc invisibles au balayage statique de
 *    `tests/i18n.test.ts`, qui ne voit que les clés écrites en toutes lettres.
 *    Sans la dérivation ci-dessous, ajouter une section dans
 *    `config/marketing.ts` sans écrire ses traductions produirait un écran en
 *    500 — `getMessageFallback` lève depuis s09 — et **aucune commande ne le
 *    dirait avant**. `tests/marketing.test.ts` confronte cette liste aux
 *    catalogues, dans chaque locale du projet.
 * 2. Un fragment de clé écrit dans un `.tsx` (`` `section.${id}.title` ``) est
 *    lu par ce même balayage comme un morceau de phrase concaténé : `« section. »`
 *    et `« .title »` sont exactement les formes qu'il existe pour attraper.
 *    Mesuré : neuf faux positifs sur trois composants. Les composants appellent
 *    donc des **fonctions nommées**, jamais un gabarit.
 *
 * La présentation et la garde de complétude lisent ainsi la même source : deux
 * dérivations divergeraient à la première section ajoutée.
 */

/** Une clé du module, qualifiée comme le registre le fera. */
export const marketingKey = (key: string): string =>
  qualifyMessageKey(MARKETING_MODULE_ID, key)

/** Le titre et la description d'une section. */
export const sectionTitleKey = (section: MarketingSection): string =>
  marketingKey(`section.${section.id}.title`)

export const sectionDescriptionKey = (section: MarketingSection): string =>
  marketingKey(`section.${section.id}.description`)

/**
 * Le titre et le corps d'un élément de section.
 *
 * Convention du module, uniforme pour les trois natures à éléments : `title`
 * est ce qui nomme, `body` ce qui développe. Une carte de fonctionnalité y lit
 * son nom et son texte ; une question de FAQ, sa question et sa réponse ; un
 * témoignage, l'auteur et la citation.
 */
export const itemTitleKey = (section: MarketingSection, item: string): string =>
  marketingKey(`section.${section.id}.item.${item}.title`)

export const itemBodyKey = (section: MarketingSection, item: string): string =>
  marketingKey(`section.${section.id}.item.${item}.body`)

export const actionKey = (section: MarketingSection, action: string): string =>
  marketingKey(`section.${section.id}.action.${action}`)

/** L'en-tête d'un document légal, et le corps de chacune de ses sections. */
export const legalTitleKey = (slug: string): string => marketingKey(`legal.${slug}.title`)

export const legalDescriptionKey = (slug: string): string =>
  marketingKey(`legal.${slug}.description`)

export const legalSectionTitleKey = (slug: string, section: string): string =>
  marketingKey(`legal.${slug}.section.${section}.title`)

export const legalSectionBodyKey = (slug: string, section: string): string =>
  marketingKey(`legal.${slug}.section.${section}.body`)

/** Les métadonnées de la page d'accueil : titre d'onglet, description, partage. */
export const HOME_TITLE_KEY = marketingKey('home.title')
export const HOME_DESCRIPTION_KEY = marketingKey('home.description')

/** Le nom accessible du pied de page. Obligatoire : deux régions anonymes sont indistinguables. */
export const FOOTER_LABEL_KEY = marketingKey('footer.label')

/** Le libellé de l'entrée de navigation du module. */
export const NAVIGATION_HOME_KEY = marketingKey('navigation.home')

/** Les clés d'une section, dans l'ordre où elles s'affichent. */
export const sectionKeys = (section: MarketingSection): readonly string[] => [
  sectionTitleKey(section),
  sectionDescriptionKey(section),
  ...section.items.flatMap((item) => [itemTitleKey(section, item), itemBodyKey(section, item)]),
  ...section.actions.map((action) => actionKey(section, action.id)),
]

/** Les clés d'un document légal : son en-tête, puis chacune de ses sections. */
export const legalKeys = (document: MarketingLegalDocument): readonly string[] => [
  legalTitleKey(document.slug),
  legalDescriptionKey(document.slug),
  ...document.sections.flatMap((section) => [
    legalSectionTitleKey(document.slug, section),
    legalSectionBodyKey(document.slug, section),
  ]),
]

/** Les clés que toute page publique demande, quelle que soit la configuration. */
const FIXED_KEYS: readonly string[] = [
  HOME_TITLE_KEY,
  HOME_DESCRIPTION_KEY,
  FOOTER_LABEL_KEY,
  NAVIGATION_HOME_KEY,
]

/**
 * Toutes les clés qu'un site exige, sans doublon.
 *
 * Un site **vide** — module coupé — n'en exige aucune, y compris les clés
 * fixes : le catalogue du module a disparu avec lui, et demander une clé
 * absente ferait tomber l'écran. C'est la même règle que `localeOptions`, qui
 * ne construit rien quand il n'y a qu'une langue (`apps/web/lib/navigation.ts`).
 */
export function marketingMessageKeys(site: {
  readonly sections: MarketingConfiguration['sections']
  readonly legalDocuments: MarketingConfiguration['legalDocuments']
}): readonly string[] {
  if (site.sections.length === 0) {
    return []
  }

  return [
    ...new Set([
      ...FIXED_KEYS,
      ...site.sections.flatMap(sectionKeys),
      ...site.legalDocuments.flatMap(legalKeys),
    ]),
  ]
}

export { isItemised }
