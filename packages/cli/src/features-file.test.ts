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

  it('refuse de réordonner la liste plutôt que d’en écrire une autre', () => {
    // Le CLI retire et il insère ; il ne déplace pas. Demander un ordre qu'il ne
    // sait pas produire doit s'arrêter là : écrire une liste différente de celle
    // qu'on a demandée est le seul mode d'échec qu'un appelant ne verrait pas.
    expect(() =>
      writeEnabledModules("export const enabledModules = ['alpha', 'beta'] as const\n", [
        'beta',
        'alpha',
      ]),
    ).toThrowError(FeaturesFileError)
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
  /**
   * L'aller-retour, avec **l'état intermédiaire vérifié**.
   *
   * Sans cette vérification, un aller-retour est vert par accident dès que le
   * retrait ne retire rien : un retrait no-op suivi d'un ajout no-op rend le
   * fichier d'origine. Le test prouverait alors que deux fonctions inertes se
   * compensent, pas que l'écriture préserve la mise en forme.
   */
  const roundTrip = (source: string, first: readonly string[], second: readonly string[]): string => {
    const once = writeEnabledModules(source, first)

    expect(readEnabledModules(once)).toEqual(first)

    return writeEnabledModules(once, second)
  }

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

  const commented = [
    'export const enabledModules = [',
    '  // le socle, jamais coupé',
    "  'socle',",
    "  'facturation',",
    '  // la roadmap publique, la vitrine du produit',
    "  'roadmap',",
    '] as const satisfies readonly AvailableModuleId[]',
    '',
  ].join('\n')

  it('sur une liste multiligne commentée : désactiver puis réactiver un élément **non final**', () => {
    // Le seul cas qui distingue une préservation d'une coïncidence. Basculer le
    // dernier élément est vert même si l'ajout appose en fin de liste ; basculer
    // celui du milieu ne l'est que si l'entrée revient à sa place.
    const after = roundTrip(commented, ['socle', 'roadmap'], ['socle', 'facturation', 'roadmap'])

    expect(after).toBe(commented)
  })

  it('sur une liste multiligne commentée : le retrait ne déplace pas les commentaires voisins', () => {
    // Les commentaires du propriétaire appartiennent aux entrées qu'ils
    // expliquent : retirer « facturation » ne doit pas faire glisser celui de
    // « roadmap » sur une autre entrée, ni emporter celui de « socle ».
    const once = writeEnabledModules(commented, ['socle', 'roadmap'])

    expect(once).toBe(
      [
        'export const enabledModules = [',
        '  // le socle, jamais coupé',
        "  'socle',",
        '  // la roadmap publique, la vitrine du produit',
        "  'roadmap',",
        '] as const satisfies readonly AvailableModuleId[]',
        '',
      ].join('\n'),
    )
  })

  it('écrit exactement la liste demandée, y compris quand l’ajout n’est pas en dernier', () => {
    // Le contrat de la fonction : la liste écrite **est** celle qu'on demande.
    // Appendre en fin de liste rendrait une autre liste que celle-là, et
    // l'appelant ne pourrait jamais rendre le fichier à son état d'origine.
    const written = writeEnabledModules(
      "export const enabledModules = ['socle', 'roadmap'] as const\n",
      ['socle', 'facturation', 'roadmap'],
    )

    expect(readEnabledModules(written)).toEqual(['socle', 'facturation', 'roadmap'])
    expect(written).toBe("export const enabledModules = ['socle', 'facturation', 'roadmap'] as const\n")
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
