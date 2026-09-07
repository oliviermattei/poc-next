import type { ModuleSeed, ModuleSeedContext } from '@repo/core'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'

import { organization, organizationActiveSelection, organizationMember } from '../schema'

/**
 * **L'organisation de démonstration** (s58).
 *
 * Elle est écrite pour les périmètres **reçus**, jamais pour des identifiants
 * que ce module irait chercher ailleurs : `eslint.config.ts` interdit à ce
 * package d'importer `@repo/module-auth` hors de `schema.ts` et de la porte de
 * lecture, et c'est cette borne qui rend l'absence d'énumération de comptes
 * structurelle. Le seed n'a donc pas à connaître les comptes : il reçoit les
 * mêmes périmètres que le module qui les crée.
 *
 * **Le premier périmètre de compte est le propriétaire**, les suivants sont
 * membres. L'ordre est celui de la liste reçue, et il est stable.
 *
 * Rien n'est écrit s'il n'y a pas d'organisation à peupler : sans périmètre
 * d'organisation, ce module n'a pas de ligne à poser, et il n'en invente pas.
 */
export type OrganizationsSeedDatabase = Pick<PgDatabase<PgQueryResultHKT>, 'insert'>

/**
 * **Manifestement fictive** : le nom porte le mot « démo », et l'identifiant
 * public aussi. Aucune raison sociale d'ici ne peut passer pour réelle.
 */
const DEMONSTRATION_ORGANIZATION = {
  name: 'Atelier Démo',
  slug: 'atelier-demo',
} as const

export const organizationsDemonstrationSeed: ModuleSeed = {
  id: 'organisation',
  run: async ({ database, demonstration }: ModuleSeedContext<OrganizationsSeedDatabase>) => {
    const organizationIds = demonstration
      .filter((scope) => scope.kind === 'organization')
      .map((scope) => scope.organizationId)
    const accountIds = demonstration
      .filter((scope) => scope.kind === 'user')
      .map((scope) => scope.userId)

    for (const organizationId of organizationIds) {
      await database
        .insert(organization)
        .values({ id: organizationId, ...DEMONSTRATION_ORGANIZATION })
        .onConflictDoNothing()

      for (const [index, userId] of accountIds.entries()) {
        await database
          .insert(organizationMember)
          .values({
            // Déterministe, comme tout ce qu'un seed écrit : c'est ce qui rend
            // la seconde exécution sans effet.
            id: `${organizationId}-${userId}`,
            organizationId,
            userId,
            role: index === 0 ? 'owner' : 'member',
          })
          .onConflictDoNothing()

        // L'organisation **active** du compte : sans elle, la découverte
        // s'ouvre sur un écran qui demande d'en choisir une, ce qui est
        // exactement le vide que cette story ferme.
        await database
          .insert(organizationActiveSelection)
          .values({ userId, organizationId })
          .onConflictDoNothing()
      }
    }
  },
}
