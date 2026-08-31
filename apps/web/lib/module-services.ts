import { organizations } from './organizations'

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
 */
export function prepareModuleServices(): void {
  organizations.prepare()
}
