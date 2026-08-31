import type { OrganizationAccess, OrganizationRepository } from '@repo/module-organizations'

/**
 * **Doit échouer** : un accès à une organisation fabriqué à la main.
 *
 * C'est la forme qui tient le périmètre organisationnel de s15. Les écritures
 * du module exigent un `OrganizationAccess`, et le seul producteur est
 * `authorizeOrganization`, qui exécute la lecture conjointe
 * « cette organisation **et** ce membre ». Passer un identifiant reçu du corps
 * de la requête — c'est exactement ce que ce fichier fait — doit être refusé
 * par le compilateur, pas par une relecture.
 *
 * Retirer la marque de type de `OrganizationAccess` fait compiler ce fichier,
 * et `tests/module-registry.test.ts` rougit : une contrainte de typage que
 * personne n'a vue échouer n'existe pas.
 */
const fromRequestBody = {
  organizationId: 'org_de_quelqu_un_d_autre',
  userId: 'usr_1',
  role: 'owner' as const,
  name: 'Studio Martin',
  slug: 'studio-martin',
}

export const forgedAccess: OrganizationAccess = fromRequestBody

export const renameWithoutAuthorization = async (
  repository: OrganizationRepository,
): Promise<unknown> =>
  await repository.renameOrganization(fromRequestBody, {
    name: 'Volé',
    slug: 'vole',
  })
