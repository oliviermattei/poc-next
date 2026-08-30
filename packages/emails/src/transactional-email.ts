import { Body, Container, Head, Html, Preview, Section, Text } from '@react-email/components'
import { createElement } from 'react'

/**
 * Le template React Email des emails transactionnels.
 *
 * Un seul composant, et c'est délibéré. Le contrat de module (ADR 007) déclare
 * le **texte** d'un email par locale (`subject`, `body`) ; ce qui varie d'un
 * module à l'autre est ce texte, pas la mise en page. Un composant React par
 * template obligerait chaque module à embarquer React et à réinventer une mise
 * en page — pour une différence que personne n'a demandée. Le jour où un module
 * aura besoin d'une mise en page propre (un bouton, un tableau de facture), il
 * déclarera son composant et le rendu le préférera ; ce jour n'est pas arrivé.
 *
 * **Écrit avec `createElement`, pas en JSX, et c'est mesuré.** Trois
 * transpileurs lisent ce dépôt, et ils ne s'accordent pas :
 *
 * | Transpileur | Ce qu'il fait d'un `.tsx` |
 * |---|---|
 * | Turbopack / SWC (`next build`) | runtime automatique — fonctionne |
 * | Vite (`pnpm test`) | runtime automatique — fonctionne |
 * | esbuild via `tsx` (`pnpm db:*`, `pnpm run audit`) | runtime **classique** : `React.createElement`, et `React` n'est pas défini |
 *
 * Sous `tsx`, le runtime JSX est décidé par le `tsconfig.json` résolu depuis le
 * **répertoire courant du processus**, et seulement si son `include` couvre le
 * fichier : `jsx: "react-jsx"` y fonctionne (comme `TSX_TSCONFIG_PATH`), mais
 * ni le `tsconfig.json` de ce package quand `tsx` est lancé de la racine, ni le
 * pragma `@jsxImportSource` seul. Mesuré avec `tsx@4.23.13` ; le détail est
 * dans l'`AGENTS.md` du package. Ce package est chargé par des scripts lancés
 * de répertoires différents (`pnpm run audit` de la racine, `pnpm db:*` de
 * `packages/db`) : il ne contrôle donc pas le réglage, et un `.tsx` ici
 * n'échouerait ni au test, ni au build, mais au premier de ces scripts, sur un
 * « React is not defined » que rien ne rattache à ce fichier. `createElement`
 * ne dépend d'aucun réglage.
 *
 * `apps/web` garde ses `.tsx` : seul Next les compile. Ce package est importé
 * par du code serveur partagé, il n'a pas ce luxe.
 *
 * Les données sont passées en **enfants de texte**, jamais en HTML brut :
 * React les échappe, donc un nom d'utilisateur ne peut pas devenir du balisage.
 */
export interface TransactionalEmailProps {
  readonly subject: string
  readonly body: string
  /**
   * Langue du document. Sans elle, `@react-email/html` retombe sur son défaut
   * (`lang="en"`) et un email français s'annonce anglais — ce que lisent les
   * lecteurs d'écran et les traducteurs des clients de messagerie.
   */
  readonly locale: string
}

export function TransactionalEmail({ subject, body, locale }: TransactionalEmailProps) {
  return createElement(
    Html,
    { lang: locale },
    createElement(Head, null),
    createElement(Preview, null, subject),
    createElement(
      Body,
      { style: { backgroundColor: '#ffffff', fontFamily: 'system-ui, sans-serif' } },
      createElement(
        Container,
        { style: { margin: '0 auto', padding: '24px', maxWidth: '600px' } },
        createElement(
          Section,
          null,
          createElement(
            Text,
            { style: { fontSize: '16px', lineHeight: '26px', color: '#18181b' } },
            body,
          ),
        ),
      ),
    ),
  )
}
