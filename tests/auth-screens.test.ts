import { NextIntlClientProvider } from 'next-intl'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { AuthForm, type AuthFormProps } from '../apps/web/app/auth-form'
import { TwoFactorForm, type TwoFactorFormProps } from '../apps/web/app/two-factor/two-factor-form'
import frMessages from '../apps/web/messages/fr.json' with { type: 'json' }
import { defaultLocale } from '../config/i18n'

/**
 * **Le formulaire partagé des écrans d'authentification, tel que le serveur le
 * rend** (s46).
 *
 * Ce fichier ne mesure pas l'habillage — une classe ne se teste pas, elle se
 * regarde dans un navigateur, et c'est ce que `e2e/auth-screens.spec.ts` fait à
 * 380 px, dans les deux thèmes. Il mesure les deux propriétés que l'habillage
 * pouvait casser en silence :
 *
 * 1. **le bouton d'envoi est éteint tant que React n'a pas repris la main** —
 *    la moitié « perte silencieuse » de la règle d'avant-hydratation
 *    (`docs/design-system.md`, § « Avant l'hydratation »). L'autre moitié,
 *    `method="post"` écrit en toutes lettres, est tenue par **`pnpm lint`** —
 *    la règle `no-restricted-syntax` d'`eslint.config.ts` (`FORM_METHOD_SYNTAX`),
 *    et pas par un fichier de cette suite : retirer l'attribut laisse
 *    `tests/lint-rules.test.ts` vert et fait rougir ESLint, vérifié par la revue
 *    de s46. La CI joue les deux étapes ;
 * 2. **le bouton éteint dit pourquoi.** Sans JavaScript il le reste pour
 *    toujours, et `apps/web/AGENTS.md` l'exige depuis le constat F5 de la revue
 *    de s11 : un `<noscript>` porte l'explication. `app/public-form.tsx` et
 *    `app/billing-actions.tsx` le faisaient, les deux formulaires des écrans
 *    d'authentification non — un bouton primaire proéminent, éteint et muet ;
 * 3. **chaque étiquette désigne son propre champ.** L'écran de connexion monte
 *    **deux** formulaires portant tous deux un champ `email` : l'identifiant
 *    dérivé du seul nom du champ était donc en double dans le document, et
 *    l'étiquette « Adresse email (lien de connexion) » désignait le champ du
 *    formulaire de mot de passe. C'est la relation qu'exercent les vingt-cinq
 *    sélecteurs `getByLabel` / `getByRole` des parcours de s07 — ils survivent
 *    à l'habillage **parce que** cette relation tient.
 */

/** Le catalogue livré, remis dans la forme imbriquée que `next-intl` consomme. */
const nest = (flat: Readonly<Record<string, string>>): Record<string, unknown> => {
  const root: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(flat)) {
    const path = key.split('.')
    const leaf = path.pop() ?? key
    let node = root

    for (const segment of path) {
      node[segment] ??= {}
      node = node[segment] as Record<string, unknown>
    }

    node[leaf] = value
  }

  return root
}

const messages = nest(frMessages as Readonly<Record<string, string>>)

/** La clé de l'explication, celle que les deux formulaires citent. */
const NOSCRIPT_KEY = 'app.auth.noscript'

const render = (...forms: readonly AuthFormProps[]): string =>
  renderToStaticMarkup(
    createElement(NextIntlClientProvider, {
      locale: defaultLocale,
      messages,
      children: forms.map((props, index) =>
        createElement(AuthForm, { key: index, ...props }),
      ),
    }),
  )

/** Le formulaire de mot de passe de `/sign-in`, tel que l'écran le déclare. */
const PASSWORD_FORM: AuthFormProps = {
  action: '/api/modules/auth/sign-in',
  fields: [
    { name: 'email', labelKey: 'app.auth.field.email', type: 'email', autoComplete: 'email' },
    {
      name: 'password',
      labelKey: 'app.auth.field.password',
      type: 'password',
      autoComplete: 'current-password',
    },
  ],
  submitLabelKey: 'app.signIn.submit',
  redirectTo: '/',
}

/** Le second formulaire du **même** écran : un champ `email`, lui aussi. */
const MAGIC_LINK_FORM: AuthFormProps = {
  action: '/api/modules/auth/magic-link',
  fields: [
    {
      name: 'email',
      labelKey: 'app.auth.field.magicLinkEmail',
      type: 'email',
      autoComplete: 'email',
    },
  ],
  submitLabelKey: 'app.signIn.magicLink.submit',
  successMessageKey: 'app.signIn.magicLink.sent',
}

const attributeValues = (markup: string, attribute: string): readonly string[] =>
  [...markup.matchAll(new RegExp(`\\s${attribute}="([^"]*)"`, 'g'))].map((match) => match[1] ?? '')

/** Le formulaire du second facteur, tel que `/two-factor` le déclare. */
const TWO_FACTOR_FORM: TwoFactorFormProps = {
  action: '/api/modules/auth/two-factor/verify-totp',
  labelKey: 'app.twoFactor.codeLabel',
  submitLabelKey: 'app.twoFactor.submit',
  autoComplete: 'one-time-code',
  numeric: true,
  destination: '/',
}

describe('le formulaire d’authentification, rendu par le serveur', () => {
  it('éteint son bouton d’envoi tant que React n’a pas repris la main', () => {
    const markup = render(PASSWORD_FORM)
    const buttons = [...markup.matchAll(/<button\b[^>]*>/g)].map((match) => match[0])

    // Garde contre l'inertie : un rendu sans bouton rendrait l'assertion
    // suivante vraie sur zéro élément.
    expect(buttons).toHaveLength(1)
    // **L'attribut, pas la sous-chaîne.** Écrite `toContain('disabled')`, cette
    // assertion était satisfaite par les classes du bouton
    // (`disabled:pointer-events-none`) : la mutation qui retire
    // `disabled={!hydrated}` la laissait verte — mesuré, et corrigé ici.
    expect(buttons[0], markup).toMatch(/\sdisabled=""/)
  })

  it('donne à chaque étiquette le champ qui lui revient, deux formulaires sur l’écran', () => {
    // C'est l'écran de connexion : le formulaire de mot de passe et celui du
    // lien de connexion, qui portent tous deux un champ nommé `email`.
    const markup = render(PASSWORD_FORM, MAGIC_LINK_FORM)

    const ids = attributeValues(markup, 'id')
    const targets = attributeValues(markup, 'for')

    // Trois champs et leurs trois étiquettes : sans ce plancher, tout ce qui
    // suit serait vrai sur un rendu vide.
    expect(ids).toHaveLength(3)
    expect(targets).toHaveLength(3)

    // Un identifiant en double, et l'étiquette du second formulaire désigne le
    // champ du premier : un lecteur d'écran, un clic sur l'étiquette et
    // `getByLabel` atterrissent alors tous les trois au mauvais endroit.
    expect(new Set(ids).size, ids.join(', ')).toBe(ids.length)

    for (const target of targets) {
      expect(ids.filter((id) => id === target), `for="${target}"`).toHaveLength(1)
    }

    // Et la relation est bien celle qu'on croit : l'étiquette du lien de
    // connexion désigne un champ **du second formulaire**.
    const [, magicLinkForm = ''] = markup.split('<form').slice(1)
    const [magicLinkTarget = ''] = attributeValues(magicLinkForm, 'for')

    expect(attributeValues(magicLinkForm, 'id')).toEqual([magicLinkTarget])
  })

  /**
   * **Le bouton éteint dit pourquoi**, et il le dit dans le seul endroit qu'un
   * navigateur sans JavaScript rend : un `<noscript>`.
   *
   * Les deux formulaires des écrans d'authentification sont mesurés ensemble
   * parce que le défaut est le même — et parce que `/two-factor` est de la même
   * famille depuis s46 : c'est un écran d'authentification, habillé comme les
   * cinq autres.
   */
  it.each([
    ['le formulaire d’authentification', () => render(PASSWORD_FORM)],
    [
      'le formulaire du second facteur',
      () =>
        renderToStaticMarkup(
          createElement(NextIntlClientProvider, {
            locale: defaultLocale,
            messages,
            children: createElement(TwoFactorForm, TWO_FACTOR_FORM),
          }),
        ),
    ],
  ])('%s dit pourquoi son bouton est éteint, sans JavaScript', (_name, renderOne) => {
    const markup = renderOne()
    const [, explanation = ''] = /<noscript>(.*?)<\/noscript>/s.exec(markup) ?? []

    // Garde contre l'inertie : un `<noscript>` vide serait un bloc rendu qui
    // n'explique rien — exactement le silence que la règle ferme.
    expect(explanation, markup).not.toBe('')
    expect(explanation).toContain(frMessages[NOSCRIPT_KEY])

    // Et il est bien **au-dessus** du bouton qu'il explique : lu après, il
    // arrive quand la personne a déjà essayé de cliquer.
    expect(markup.indexOf('<noscript>')).toBeLessThan(markup.indexOf('<button'))
  })
})
