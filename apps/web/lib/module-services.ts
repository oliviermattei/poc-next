import { getDatabase } from '@repo/db'
import { provideMarketing } from '@repo/module-marketing'

import { appAuth } from './auth'
import { billing } from './billing'
import { consent } from './consent'
import { localeRouting } from './locale-routing'
import { prepareModuleContent } from './module-content'
import { createAppMailer } from './mailer'
import { marketingSite } from './marketing'
import { organizations } from './organizations'
import { appRateLimiter } from './rate-limit'
import { storage } from './storage'

/**
 * Ce que les modules attendent de l'application **avant** qu'une de leurs
 * routes ne soit servie.
 *
 * Le répartiteur monte les routes ; il ne construit rien. Un module qui persiste
 * reçoit sa connexion de son point de composition (ADR 020), et rien dans le
 * chemin d'une requête d'API n'importerait ce point de composition autrement :
 * mesuré au navigateur, la première soumission de formulaire d'organisation
 * répondait 500 en disant « le module n'est pas configuré ». Le module `auth`
 * échappait au problème par accident — le répartiteur appelle son
 * `resolveSession` à chaque requête, et c'est cet appel qui le construit.
 *
 * Ce fichier est donc **le pendant de `lib/module-registry.ts`** : celui-ci dit
 * quels modules existent, celui-là leur donne ce qu'ils ne peuvent pas se
 * procurer. Le fichier de route reste ignorant des modules : il appelle une
 * fonction, pas un module.
 *
 * La construction reste **différée** : la faire à l'import ouvrirait la base
 * pendant `pnpm build`, qui n'a ni `DATABASE_URL` ni raison d'en avoir une.
 * Chaque point de composition est idempotent — le second appel rend le service
 * déjà construit.
 *
 * **Pourquoi le site public est câblé ici et non dans `lib/marketing.ts`**,
 * contrairement aux organisations : le harnais de parcours importe
 * `lib/marketing.ts` **hors de Next** pour en dériver ses attentes
 * (`e2e/support/locale.ts`). Y importer `lib/auth`, qui lit `next/headers`,
 * fait échouer le chargement de tous les parcours avant qu'aucun ne s'exécute —
 * mesuré. Ce fichier-ci n'est importé que par la route d'API.
 */
const provideMarketingForms = (): void => {
  const forms = marketingSite.forms

  if (forms === null) {
    return
  }

  provideMarketing(() => ({
    db: getDatabase().db,
    mailer: createAppMailer(),
    // s28 : le compteur **partagé**. Le module garde sa règle des deux seaux —
    // dont celui qui dégrade —, mais il ne tient plus sa propre table.
    rateLimiter: appRateLimiter(),
    forms,
    locales: localeRouting.locales,
    defaultLocale: localeRouting.defaultLocale,
    /**
     * Le seul endroit qui relie une inscription publique à un compte.
     *
     * Le module ne connaît pas `auth` et n'a pas le droit de lire ses tables :
     * le contrat lui donne un identifiant de compte, pas une adresse. Il reçoit
     * donc la résolution, faite ici par le service d'authentification — même
     * patron que `reservedSlugs` pour les organisations.
     *
     * Périmètre organisation : `null`. Une inscription publique est faite par
     * quelqu'un qui n'a, le plus souvent, aucun compte ; elle n'appartient à
     * aucune organisation.
     */
    emailOfScope: async (scope) =>
      scope.kind === 'organization'
        ? null
        : ((await appAuth().useCases.viewAccount(scope.userId))?.email ?? null),
  }))
}

export function prepareModuleServices(): void {
  // Le **contenu** que les modules publient (s53) : le flux RSS du blog est une
  // route montée, donc servie par ce chemin-ci. Sans cet appel, elle répond 500
  // en disant que le contenu n'a pas été fourni — mesuré au navigateur, et
  // c'est la seule raison pour laquelle un `provide*` oublié se voit.
  prepareModuleContent()
  consent.prepare()
  organizations.prepare()
  billing.prepare()
  provideMarketingForms()
  storage.prepare()
}
