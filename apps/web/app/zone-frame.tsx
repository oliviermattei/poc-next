import { ImpersonationBanner } from '@repo/module-admin/presentation'
import type { ConsentState } from '@repo/module-consent'
import { ConsentBanner, ConsentScripts } from '@repo/module-consent/presentation'
import { cn } from '@repo/ui'
import type { ReactNode } from 'react'

import { currentImpersonation } from '../lib/admin'
import type { AppIntl } from '../lib/i18n'

/**
 * **Ce que chaque gabarit de zone rend, quel qu'il soit** (s61, critère 5).
 *
 * Les gabarits Site, Hors zone et Application diffèrent par ce qui entoure le
 * contenu — en-tête, barre minimale, barre latérale. Ils ne diffèrent **pas** sur
 * trois choses, et c'est pourquoi elles vivent ici, une seule fois : le bandeau
 * d'emprunt de session (s37b1), la bannière et les scripts de consentement
 * (s36, avec le nonce) et la réserve de place sous la bannière. Recopiées dans
 * trois layouts, la première qui en oublie une rendrait un écran où
 * l'emprunteur ne sait plus qu'il agit au nom d'un autre, ou où aucun choix de
 * cookies n'est proposé.
 *
 * **Aucune lecture ici** : le composant est synchrone, et ses données lui sont
 * données par le gabarit, qui les a déjà — l'emprunt sort de `currentViewer()`,
 * le consentement du cookie. C'est ce qui garde `tests/marketing.test.ts`, qui
 * compte les connexions ouvertes au rendu, sur le coût du gabarit seul.
 */
export function ZoneFrame({
  children,
  nonce,
  intl,
  consent,
  impersonatedBy,
  accountEmail,
  variant,
}: {
  readonly children: ReactNode
  /** Le nonce de la requête, relu par le layout de la zone (s60, ADR 071). */
  readonly nonce: string | null
  readonly intl: Pick<AppIntl, 'locale' | 't' | 'path'>
  readonly consent: ConsentState
  /** L'emprunteur, tel que `currentViewer()` le rend — `null` hors emprunt. */
  readonly impersonatedBy: string | null
  /** Le compte emprunté, que le bandeau nomme. */
  readonly accountEmail: string | null
  /**
   * La mise en page du contenu, propre au gabarit : `contained` pour le site
   * et l'application (colonne bornée, comme avant s61), `centered` pour
   * l'authentification (l'écran centré sous la barre minimale).
   */
  readonly variant: 'contained' | 'centered'
}) {
  const { t } = intl
  const impersonation = currentImpersonation(impersonatedBy)

  return (
    <>
      {/*
        **La bannière réserve sa place plutôt que de couvrir la page.**
        Mesuré : posée en surface fixe sans cette réserve, elle interceptait
        les clics de dix parcours — pied de page marketing, formulaires de
        fin d'écran, actions d'une ligne de membre à 390 px. Ce n'était pas
        un défaut de test : un visiteur ne pouvait littéralement pas
        atteindre le bas de la page avant d'avoir répondu, ce qui revient à
        rendre la bannière modale par accident — exactement ce que le design
        refuse. La réserve est plus haute sous `md`, où les deux boutons
        passent en colonne.
      */}
      <main
        className={cn(
          'min-w-0 flex-1',
          variant === 'contained'
            ? 'px-4 py-6 md:px-8 md:py-10'
            : 'flex min-h-[calc(100svh-3.5rem)] flex-col justify-center px-4 py-6',
          consent.bannerRequired && 'pb-64 md:pb-36',
        )}
      >
        <div
          className={cn(
            'mx-auto flex w-full min-w-0 flex-col gap-6',
            variant === 'contained' && 'max-w-4xl',
          )}
        >
          {/*
            **Au-dessus du contenu de la page, dans le gabarit.** C'est la
            position qui porte la garantie : le bandeau est rendu par ce
            fichier, donc il est là sur chaque écran de chaque zone, y compris
            ceux qu'aucune story d'administration n'a écrits. Une page qui le
            rendrait le perdrait au premier lien suivi.
          */}
          {impersonation === null ? null : (
            <ImpersonationBanner
              /*
                **Les textes viennent du catalogue de l'application**, pas de
                celui du module. Le bandeau est rendu dans toutes les
                configurations, y compris celle où `admin` est coupé — et le
                catalogue d'un module coupé n'existe plus, si bien qu'une clé
                `admin.*` ferait tomber **chaque écran** en 500 pour la
                personne dont la session est empruntée. Mesuré par
                `pnpm test:minimal-profile`.
              */
              labels={{
                title: t('app.shell.impersonation.title'),
                /*
                  **Il nomme le compte emprunté**, comme le design l'exige :
                  « vous agissez au nom d'un autre » sans dire duquel laisse
                  l'emprunteur deviner sur quel dossier il travaille. Le nom
                  est celui de la session en cours — donc du compte emprunté,
                  jamais de l'emprunteur —, et il ne coûte aucune lecture.
                */
                description: t('app.shell.impersonation.description', {
                  account: accountEmail ?? '',
                }),
                stop: t('app.shell.impersonation.stop'),
                noExit: t('app.shell.impersonation.noExit'),
              }}
              stopAction={impersonation.stopAction}
            />
          )}
          {children}
        </div>
      </main>

      {/*
        **En fin de document**, et les deux pour la même raison. La bannière ne
        doit pas précéder le contenu pour une aide technique : elle est une
        annonce, pas un préambule. Les scripts non essentiels, eux, ne sont rendus
        que si leur catégorie est accordée — aucune balise n'existe avant le
        choix, ce que `e2e/consent.spec.ts` vérifie sur les requêtes réellement
        émises.
      */}
      <ConsentBanner state={consent} intl={intl} />
      <ConsentScripts scripts={consent.allowedScripts} nonce={nonce} />
    </>
  )
}
