import {
  parseMarketingConfiguration,
  type MarketingConfiguration,
  type MarketingForms,
  type MarketingLegalDocument,
  type MarketingSection,
} from '../domain/marketing-config'

/**
 * Le site public, tel que l'application le lit — **de forme identique dans les
 * deux états**.
 *
 * C'est la même leçon que `LocaleRouting` (s09) : un écran, une entrée de
 * navigation ou une story écrite après s10 appelle `sections`, `legalDocuments`
 * et `publicPaths` sans savoir si le module marketing est activé. Module coupé,
 * les trois listes sont vides — et rien, nulle part, ne porte de branche
 * « si le module existe ». Une condition sur l'identifiant d'un module dans du
 * code appelant est un défaut, pas une précaution (`apps/web/AGENTS.md`).
 */
export interface MarketingSite {
  readonly sections: readonly MarketingSection[]
  readonly legalDocuments: readonly MarketingLegalDocument[]
  /** Les chemins **internes** que le site sert publiquement, accueil en tête. */
  readonly publicPaths: readonly string[]
  /**
   * Les formulaires publics, ou `null` quand le module est coupé.
   *
   * `null` est une **donnée**, pas une condition : c'est lui qui fait
   * disparaître l'écran de contact, la section d'inscription et le lien du pied
   * de page, sans qu'un seul composant ne nomme un module.
   */
  readonly forms: MarketingForms | null
}

/** L'état « aucun site public » : celui du module coupé, écrit une fois. */
export const EMPTY_MARKETING_SITE: MarketingSite = {
  sections: [],
  legalDocuments: [],
  publicPaths: [],
  forms: null,
}

/** Le chemin d'un document légal. Une seule écriture, lue par la page et par le plan de site. */
export const legalPath = (slug: string): string => `/legal/${slug}`

/**
 * Le chemin de l'écran de contact.
 *
 * Écrit **une fois**, et lu par l'écran, par le pied de page et par
 * `publicPaths` — donc par le plan de site et par la politique des robots. Une
 * seconde écriture ferait une page annoncée à un endroit et interdite à
 * l'autre : c'est le mode de panne que le correctif F1 de s10 a fermé.
 */
export const CONTACT_PATH = '/contact'

/**
 * Valide la configuration reçue et en dérive le site.
 *
 * `publicPaths` est **dérivé**, jamais recopié : c'est lui que consomment le
 * plan de site, la politique des robots et le pied de page. Une liste écrite à
 * la main à côté divergerait au premier document légal ajouté.
 */
export function resolveMarketingSite(configuration: unknown): MarketingSite {
  const parsed: MarketingConfiguration = parseMarketingConfiguration(configuration)

  return {
    sections: parsed.sections,
    legalDocuments: parsed.legalDocuments,
    publicPaths: [
      '/',
      CONTACT_PATH,
      ...parsed.legalDocuments.map((document) => legalPath(document.slug)),
    ],
    forms: parsed.forms,
  }
}

/**
 * Le document légal d'un slug, ou `null`.
 *
 * `null` est ce qui fera un 404, et c'est le seul comportement correct : un
 * slug qui n'est pas dans la configuration n'existe pas, qu'il s'agisse d'une
 * faute de frappe, d'un document retiré ou d'une tentative de traversée de
 * chemin. La comparaison porte sur la liste déclarée, jamais sur le système de
 * fichiers.
 */
export function legalDocumentOf(
  site: MarketingSite,
  slug: string,
): MarketingLegalDocument | null {
  return site.legalDocuments.find((document) => document.slug === slug) ?? null
}
