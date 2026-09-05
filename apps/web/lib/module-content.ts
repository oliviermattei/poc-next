import { prepareBlogContent } from './blog'
import { prepareDocsContent } from './docs'
import { prepareMarketingContent } from './marketing'

/**
 * Ce que les modules attendent de l'application **avant** qu'on leur demande ce
 * qu'ils publient (s53).
 *
 * C'est le pendant de `lib/module-services.ts`, en beaucoup plus léger : celui-là
 * donne aux modules une base, un mailer et un limiteur, celui-ci ne leur donne
 * que du **contenu déjà résolu** — les chemins publics validés depuis
 * `config/marketing.ts`, le catalogue d'articles lu sur le disque. Aucune
 * connexion, aucun `next/headers` : `app/robots.ts` et `app/sitemap.ts`
 * l'appellent, et ils doivent rester chargeables hors de Next (la suite Vitest
 * les importe directement).
 *
 * **C'est la seule énumération de modules de contenu du dépôt**, et elle est
 * assumée : les deux contributions dépendent de données que seule l'application
 * possède, donc quelqu'un doit les remettre. Ce que cette énumération n'est
 * pas : une condition. Un module coupé n'est pas dans le registre, sa
 * contribution n'est jamais demandée, et l'appeler ici ne change rien —
 * `provide*` dit **où** lire, il ne lit pas.
 *
 * Un module de contenu ajouté demain ajoute une ligne **ici**, et zéro dans les
 * deux fichiers de métadonnées : c'est là que se joue le critère 4 de la story.
 *
 * Idempotente : chaque `provide*` remplace la fabrique précédente par la même.
 */
export function prepareModuleContent(): void {
  prepareMarketingContent()
  prepareBlogContent()
  prepareDocsContent()
}
