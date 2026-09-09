import { LocaleSwitcher, ThemeToggle } from '@repo/ui'

import { authRoutePath } from '../../lib/auth'
import type { AppIntl } from '../../lib/i18n'
import { localeRouting } from '../../lib/locale-routing'
import { localeOptions } from '../../lib/navigation'
import { AccountMenu } from '../account-menu'

/**
 * **Les gestes que le back-office emprunte au produit** — et rien d'autre.
 *
 * Trois, et chacun sert celui qui administre : la langue, quand l'application
 * en sert plusieurs ; le thème ; le menu de compte, réduit à l'identité et à la
 * déconnexion.
 *
 * **Ce qui n'y est pas** : le compteur de notifications — elles appartiennent
 * au produit, pas à la plateforme —, la bannière de consentement et les scripts
 * tiers — cette surface n'est pas publique, aucun visiteur ne l'atteint, et
 * charger un traceur d'audience sur l'écran d'administration mesurerait
 * l'exploitant au lieu du produit.
 *
 * **Il ne lit rien.** Le compte et le catalogue lui sont passés par la page,
 * qui les a déjà payés pour rendre son écran : les relire ici ajouterait une
 * résolution de session par page d'administration, et ferait de ce composant un
 * composant asynchrone — que `tests/rendered-text.test.ts` ne saurait pas
 * rendre, et qui suspendrait au milieu d'une coquille.
 *
 * Le sélecteur de langue suit la règle du produit : il paraît quand
 * l'application **sert** plusieurs langues, jamais parce qu'un module s'appelle
 * `i18n`.
 */
export function BackOfficeActions({
  intl,
  account,
}: {
  readonly intl: AppIntl
  /**
   * L'identité affichée, et rien de plus. Le compte entier porte un
   * identifiant que cet en-tête n'affiche pas — le passer ferait entrer une
   * donnée technique dans l'arbre rendu, que `tests/rendered-text.test.ts`
   * relève à juste titre.
   */
  readonly account: { readonly email: string; readonly name: string } | null
}) {
  const languages = localeOptions(localeRouting, intl)

  return (
    <>
      {languages.length === 0 ? null : (
        <LocaleSwitcher
          label={intl.t('i18n.switcher.label')}
          current={intl.locale}
          options={languages}
        />
      )}
      <ThemeToggle
        label={intl.t('app.shell.theme.label')}
        options={{
          light: intl.t('app.shell.theme.light'),
          dark: intl.t('app.shell.theme.dark'),
          system: intl.t('app.shell.theme.system'),
        }}
      />
      {account === null ? null : (
        <AccountMenu
          email={account.email}
          name={account.name}
          accountHref={intl.path('/account')}
          signOutAction={authRoutePath('signOut')}
          // **Aucune image.** L'avatar est une lecture de stockage par page, et
          // le back-office montre déjà l'adresse de celui qui administre : il
          // n'a rien à identifier de plus.
          avatarUrl={null}
        />
      )}
    </>
  )
}
