import { loadRootEnv } from '@repo/config/server'

/**
 * `pnpm billing:reconcile` — **la commande de réconciliation**
 * (`docs/reliability.md` §5).
 *
 * « Toute divergence possible avec un système externe possède une commande de
 * réconciliation. » Ce que le module `billing` stocke est un **cache** de ce que
 * le fournisseur détient (ADR 034) : il diverge quand un webhook se perd, quand
 * deux événements partagent une seconde, ou quand un abonnement est créé depuis
 * le tableau de bord du fournisseur.
 *
 * Elle est **rejouable sans effet supplémentaire** : la seconde exécution
 * n'écrit rien, et c'est le compte rendu qui le dit. `tests/billing.test.ts` le
 * prouve en l'exécutant deux fois.
 *
 * Le `.env` racine est chargé **avant** le point de composition : celui-ci lit
 * l'environnement à la construction du port, et un script lancé hors de Next
 * n'a pas eu de `next.config.ts` pour le charger à sa place.
 */
loadRootEnv()

const { billing } = await import('../apps/web/lib/billing')

if (!billing.available) {
  // Ce n'est pas une erreur : un projet qui ne vend rien n'a rien à
  // réconcilier. La commande le dit et sort proprement, pour qu'un
  // ordonnanceur ne la voie pas échouer tous les jours.
  console.log('Module « billing » non activé : rien à réconcilier.')
  process.exit(0)
}

const report = await billing.reconcile()

console.log(
  `Réconciliation terminée : ${report.customers} client(s) relu(s), ` +
    `${report.changed} abonnement(s) réécrit(s).`,
)

// Une seconde exécution doit rendre « 0 abonnement réécrit ». C'est la
// vérification que `docs/reliability.md` §1 demande : on l'exécute deux fois et
// on constate un seul effet.
process.exit(0)
