import type { FeatureGate } from '@repo/core'
import { DEMO_PREMIUM_FEATURE } from '@repo/module-demo-enabled'

/**
 * Les fonctionnalités réservées aux offres payantes — **le fichier que le
 * propriétaire édite** (s21, ADR 043).
 *
 * Une ligne dit : « cette fonctionnalité est ouverte par ces offres ». Rien de
 * plus. C'est tout ce qu'il y a à écrire pour monétiser une fonctionnalité, et
 * c'est le but de la story : aucune logique d'accès à écrire dans un écran ou
 * dans une route.
 *
 * **Trois choses à savoir avant d'y toucher.**
 *
 * 1. **L'identifiant vient du module qui réserve la fonctionnalité**, jamais
 *    d'un littéral recopié : une route le déclare dans sa protection
 *    (`{ level: 'entitlement', feature }`), et le démarrage refuse une route
 *    dont la fonctionnalité n'est pas déclarée ici — elle serait refusée à tout
 *    le monde, en silence.
 * 2. **`offers` est une disjonction** : détenir **une** de ces offres suffit.
 *    Il n'y a pas de niveaux ordonnés, et c'est délibéré — une licence à vie et
 *    un abonnement mensuel ne se comparent pas, et le premier ordre écrit
 *    serait faux.
 * 3. **Module de facturation coupé, tout est accordé** (critère 6 de la story).
 *    Un projet qui ne vend rien ne réserve rien : la vérification accorde
 *    toutes les fonctionnalités déclarées ici, et aucune invitation à souscrire
 *    n'apparaît. Ce fichier reste lisible dans les deux états, et c'est ce qui
 *    permet à l'écran d'être le même.
 *
 * Ce que ce fichier ne fait **pas**, et ne doit pas faire : compter. Un quota —
 * un nombre d'objets, de fichiers, d'appels — est la brique dont la facturation
 * à l'usage a besoin, et elle est au cimetière (`docs/prd.md`). Le gating porte
 * sur l'appartenance à une offre, jamais sur un volume consommé.
 */
export const featureGates = [
  {
    /**
     * Le rapport détaillé du module de démonstration.
     *
     * Il est là pour que le mécanisme soit **exercé en continu** — route
     * réservée, refus 403, invitation à souscrire — comme `demo-disabled`
     * exerce en continu l'absence d'un module coupé. Un projet réel remplace
     * cette ligne par les siennes.
     */
    id: DEMO_PREMIUM_FEATURE,
    offers: ['pro-monthly', 'pro-yearly', 'lifetime'],
  },
] as const satisfies readonly FeatureGate[]
