/**
 * Le module du site public — **optionnel**, et c'est tout son intérêt.
 *
 * Trois surfaces sortent d'ici, et elles n'ont pas le même public :
 *
 * - le **contrat** (`marketingModule`), lu par `config/features.ts` ;
 * - la **règle** (`resolveMarketingSite` et le domaine), appelée par le point de
 *   composition de l'application, qui possède `config/marketing.ts` ;
 * - la **présentation**, composée depuis `@repo/ui` et rendue par les écrans —
 *   sur un **second point d'entrée**, `@repo/module-marketing/presentation`.
 *
 * Ce second point d'entrée n'est pas une élégance : `config/features.ts`
 * importe le contrat, et ce fichier est lu par `pnpm db:generate` comme par
 * `pnpm ks`, dont les compilateurs ne connaissent pas le JSX. Réexporter un
 * `.tsx` d'ici faisait échouer le `typecheck` de `@repo/db` sur
 * « `--jsx` is not set » — mesuré. Un module à composants n'a pas à obliger
 * chaque outil du dépôt à savoir compiler du JSX.
 */
export { marketingModule } from './module'
export {
  EMPTY_MARKETING_SITE,
  legalDocumentOf,
  legalPath,
  resolveMarketingSite,
  type MarketingSite,
} from './application/marketing-site'
export {
  MARKETING_MODULE_ID,
  MarketingConfigurationError,
  SECTION_KINDS,
  parseMarketingConfiguration,
  type MarketingAction,
  type MarketingConfiguration,
  type MarketingConfigurationInput,
  type MarketingLegalDocument,
  type MarketingSection,
  type MarketingSectionKind,
} from './domain/marketing-config'
export {
  HOME_DESCRIPTION_KEY,
  HOME_TITLE_KEY,
  legalDescriptionKey,
  legalTitleKey,
  marketingKey,
  marketingMessageKeys,
} from './domain/message-keys'
export {
  marketingRobotsPolicy,
  marketingSitemapEntries,
  robotsAllows,
  type RobotsPolicy,
  type SitemapEntry,
} from './domain/seo'
