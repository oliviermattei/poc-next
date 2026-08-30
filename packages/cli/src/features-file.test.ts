import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { FeaturesFileError, readEnabledModules, writeEnabledModules } from './features-file'

/**
 * L'édition de `config/features.ts` est la seule écriture du CLI dans un fichier
 * que le propriétaire lit et modifie à la main. Elle passe par l'AST, jamais par
 * une expression régulière : le fichier porte des commentaires explicatifs, et
 * une réécriture textuelle les détruit au premier cas non prévu.
 *
 * Le seul contrôle qui le prouve est l'**identité octet pour octet** après un
 * toggle et son inverse. Une comparaison « à la mise en forme près » laisserait
 * passer exactement ce qu'on redoute.
 *
 * **Rien ici ne suppose quels modules sont activés.** Le fichier réel du dépôt
 * sert de matériau — ses commentaires sont ce qu'on protège — mais aucune
 * assertion ne recopie sa configuration : la suite doit passer dans les trois
 * états, sans quoi la recette de modularité (s26) devrait l'excepter.
 */
const REPO_FEATURES = readFileSync(
  fileURLToPath(new URL('../../../config/features.ts', import.meta.url)),
  'utf8',
)

/** Un identifiant qu'aucun état de la configuration ne contient. */
const FICTIF = 'module-fictif'

const CURRENT = readEnabledModules(REPO_FEATURES)

describe('lecture de `enabledModules`', () => {
  it('rend les identifiants littéraux de la liste', () => {
    expect(
      readEnabledModules("export const enabledModules = ['alpha', 'beta'] as const\n"),
    ).toEqual(['alpha', 'beta'])
  })

  it('rend une liste vide quand aucun module n’est activé', () => {
    expect(readEnabledModules('export const enabledModules = [] as const\n')).toEqual([])
  })

  it('refuse un fichier sans `enabledModules`, en le disant', () => {
    expect(() => readEnabledModules('export const availableModules = []\n')).toThrowError(
      FeaturesFileError,
    )
  })

  it('refuse un élément qui n’est pas un identifiant littéral', () => {
    // Un identifiant calculé rendrait toute écriture ultérieure destructrice :
    // le CLI ne peut pas savoir ce qu'il remplace. Il refuse au lieu d'écrire.
    expect(() =>
      readEnabledModules("export const enabledModules = [...autres, 'demo-enabled']\n"),
    ).toThrowError(FeaturesFileError)
  })
})

describe('écriture de `enabledModules`', () => {
  it('réécrire ce qu’on vient de lire ne change pas un octet du fichier', () => {
    // Lecture et écriture se répondent : si elles divergeaient, un toggle
    // réécrirait le fichier même là où il ne change rien.
    expect(writeEnabledModules(REPO_FEATURES, CURRENT)).toBe(REPO_FEATURES)
  })

  it('active un module sans toucher aux commentaires du fichier', () => {
    const written = writeEnabledModules(REPO_FEATURES, [...CURRENT, FICTIF])

    expect(readEnabledModules(written)).toEqual([...CURRENT, FICTIF])
    // Les commentaires du propriétaire, mot pour mot : tout ce qui n'est pas la
    // liste des activés est inchangé.
    expect(written.slice(0, written.indexOf('export const enabledModules'))).toBe(
      REPO_FEATURES.slice(0, REPO_FEATURES.indexOf('export const enabledModules')),
    )
  })

  it('ne touche pas à l’annuaire `availableModules`', () => {
    const written = writeEnabledModules(REPO_FEATURES, [])
    const directory = (text: string) =>
      text.slice(
        text.indexOf('export const availableModules'),
        text.indexOf('export type AvailableModuleId'),
      )

    expect(directory(written)).toBe(directory(REPO_FEATURES))
  })

  it('refuse d’écrire dans un fichier sans `enabledModules`', () => {
    expect(() => writeEnabledModules('export const availableModules = []\n', ['x'])).toThrowError(
      FeaturesFileError,
    )
  })
})

/**
 * Le critère qui décide : « un toggle suivi du toggle inverse laisse le fichier
 * identique à son état initial ». Éprouvé sur le fichier réel du dépôt **et**
 * sur les mises en forme que le propriétaire peut lui donner à la main.
 */
describe('toggle puis toggle inverse rend le fichier octet pour octet identique', () => {
  const roundTrip = (source: string, first: readonly string[], second: readonly string[]): string =>
    writeEnabledModules(writeEnabledModules(source, first), second)

  it('sur le fichier du dépôt : activer puis désactiver', () => {
    expect(roundTrip(REPO_FEATURES, [...CURRENT, FICTIF], CURRENT)).toBe(REPO_FEATURES)
  })

  it('sur le fichier du dépôt : désactiver puis réactiver', () => {
    // Le sens inverse a besoin d'un module présent au départ, quel que soit
    // l'état du dépôt : on part donc du fichier augmenté de l'identifiant
    // fictif, et c'est lui qu'on retire puis remet.
    const augmented = writeEnabledModules(REPO_FEATURES, [...CURRENT, FICTIF])

    expect(roundTrip(augmented, CURRENT, [...CURRENT, FICTIF])).toBe(augmented)
  })

  const multiline = [
    'export const enabledModules = [',
    '  // le socle, jamais coupé',
    "  'demo-enabled',",
    "  'demo-disabled',",
    '] as const satisfies readonly AvailableModuleId[]',
    '',
  ].join('\n')

  it('sur une liste multiligne à virgule finale : désactiver puis réactiver', () => {
    const after = roundTrip(multiline, ['demo-enabled'], ['demo-enabled', 'demo-disabled'])

    expect(after).toBe(multiline)
    expect(after).toContain('// le socle, jamais coupé')
  })

  it('sur une liste multiligne : retirer le premier conserve le commentaire du suivant', () => {
    const source = [
      'export const enabledModules = [',
      "  'demo-enabled',",
      '  // celui-ci porte son explication',
      "  'demo-disabled',",
      ']',
      '',
    ].join('\n')

    expect(writeEnabledModules(source, ['demo-disabled'])).toContain(
      '// celui-ci porte son explication',
    )
  })

  const singleLineMultiple =
    "export const enabledModules = ['demo-enabled', 'demo-disabled'] as const\n"

  it('sur une liste d’une ligne : retirer le premier ne laisse pas d’espace parasite', () => {
    expect(writeEnabledModules(singleLineMultiple, ['demo-disabled'])).toBe(
      "export const enabledModules = ['demo-disabled'] as const\n",
    )
  })

  it('sur une liste d’une ligne : retirer le dernier ne laisse pas de virgule parasite', () => {
    expect(writeEnabledModules(singleLineMultiple, ['demo-enabled'])).toBe(
      "export const enabledModules = ['demo-enabled'] as const\n",
    )
  })
})
