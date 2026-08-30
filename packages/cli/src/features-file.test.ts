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

/**
 * Le texte écrit. L'écriture rend aussi **ce qu'elle a changé sans qu'on le lui
 * demande** — l'ordre normalisé, le commentaire emporté — et ces deux champs
 * sont éprouvés à part : le CLI les annonce, ils ne sont pas décoratifs.
 */
const write = (source: string, next: readonly string[]): string =>
  writeEnabledModules(source, next).text

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
    expect(write(REPO_FEATURES, CURRENT)).toBe(REPO_FEATURES)
  })

  it('active un module sans toucher aux commentaires du fichier', () => {
    const written = write(REPO_FEATURES, [...CURRENT, FICTIF])

    expect(readEnabledModules(written)).toEqual([...CURRENT, FICTIF])
    // Les commentaires du propriétaire, mot pour mot : tout ce qui n'est pas la
    // liste des activés est inchangé.
    expect(written.slice(0, written.indexOf('export const enabledModules'))).toBe(
      REPO_FEATURES.slice(0, REPO_FEATURES.indexOf('export const enabledModules')),
    )
  })

  it('ne touche pas à l’annuaire `availableModules`', () => {
    const written = write(REPO_FEATURES, [])
    const directory = (text: string) =>
      text.slice(
        text.indexOf('export const availableModules'),
        text.indexOf('export type AvailableModuleId'),
      )

    expect(directory(written)).toBe(directory(REPO_FEATURES))
  })

  it('réordonne une liste écrite à la main, et dit lesquelles ont bougé', () => {
    // ADR 019 : l'ordre de `enabledModules` est celui de l'annuaire. Le CLI
    // l'établit lui-même, une fois — et il ne le fait pas en silence, sinon la
    // liste qu'un propriétaire a ordonnée à la main change sans qu'il le sache.
    const edit = writeEnabledModules("export const enabledModules = ['beta', 'alpha'] as const\n", [
      'alpha',
      'beta',
    ])

    expect(edit.text).toBe("export const enabledModules = ['alpha', 'beta'] as const\n")
    expect(edit.reordered).toEqual(['beta', 'alpha'])
  })

  it('emmène le commentaire d’une entrée déplacée avec elle', () => {
    const edit = writeEnabledModules(
      [
        'export const enabledModules = [',
        '  // la vitrine publique',
        "  'roadmap',",
        "  'socle', // jamais coupé",
        '] as const',
        '',
      ].join('\n'),
      ['socle', 'roadmap'],
    )

    expect(edit.text).toBe(
      [
        'export const enabledModules = [',
        "  'socle', // jamais coupé",
        '  // la vitrine publique',
        "  'roadmap',",
        '] as const',
        '',
      ].join('\n'),
    )
  })

  it('n’écrit rien quand on lui demande deux fois le même identifiant', () => {
    // Écrire une liste différente de celle qu'on a demandée est le seul mode
    // d'échec qu'un appelant ne verrait pas.
    expect(() =>
      write("export const enabledModules = ['alpha'] as const\n", ['alpha', 'alpha']),
    ).toThrowError(FeaturesFileError)
  })

  it('refuse d’écrire dans un fichier sans `enabledModules`', () => {
    expect(() => write('export const availableModules = []\n', ['x'])).toThrowError(
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
    const once = write(source, first)

    expect(readEnabledModules(once)).toEqual(first)

    return write(once, second)
  }

  it('sur le fichier du dépôt : activer puis désactiver', () => {
    expect(roundTrip(REPO_FEATURES, [...CURRENT, FICTIF], CURRENT)).toBe(REPO_FEATURES)
  })

  it('sur le fichier du dépôt : désactiver puis réactiver', () => {
    // Le sens inverse a besoin d'un module présent au départ, quel que soit
    // l'état du dépôt : on part donc du fichier augmenté de l'identifiant
    // fictif, et c'est lui qu'on retire puis remet.
    const augmented = write(REPO_FEATURES, [...CURRENT, FICTIF])

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

    expect(write(source, ['demo-disabled'])).toContain(
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
    const once = write(commented, ['socle', 'roadmap'])

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

  it('le retrait emporte le commentaire de l’entrée retirée, et le signale', () => {
    // La limite du CLI, écrite là où on la vérifie. Le commentaire appartient à
    // l'entrée : le laisser en place l'attribuerait à « socle », et le fichier
    // documenterait le mauvais module. Il part donc avec elle — et **ne revient
    // pas** : l'aller-retour est fait de deux invocations, et à la seconde le
    // texte n'existe plus nulle part. D'où `droppedComments`, que le CLI dit.
    const edit = writeEnabledModules(commented, ['socle', 'facturation'])

    expect(edit.text).not.toContain('la roadmap publique')
    expect(edit.droppedComments).toEqual(['roadmap'])
    expect(write(edit.text, ['socle', 'facturation', 'roadmap'])).not.toContain(
      'la roadmap publique',
    )
  })

  it('écrit exactement la liste demandée, y compris quand l’ajout n’est pas en dernier', () => {
    // Le contrat de la fonction : la liste écrite **est** celle qu'on demande.
    // Appendre en fin de liste rendrait une autre liste que celle-là, et
    // l'appelant ne pourrait jamais rendre le fichier à son état d'origine.
    const written = write(
      "export const enabledModules = ['socle', 'roadmap'] as const\n",
      ['socle', 'facturation', 'roadmap'],
    )

    expect(readEnabledModules(written)).toEqual(['socle', 'facturation', 'roadmap'])
    expect(written).toBe("export const enabledModules = ['socle', 'facturation', 'roadmap'] as const\n")
  })

  const trailingComma = [
    'export const enabledModules = [',
    "  'socle',",
    "  'facturation',",
    '] as const satisfies readonly AvailableModuleId[]',
    '',
  ].join('\n')

  it('retirer la dernière entrée d’une liste multiligne lui laisse sa virgule finale', () => {
    // La virgule finale est une propriété de la **liste**, pas de l'entrée qui
    // se trouve être la dernière. L'emporter avec l'entrée retirée change la
    // mise en forme du propriétaire, et le sens activation → désactivation ne
    // rend plus le fichier d'origine.
    expect(write(trailingComma, ['socle'])).toBe(
      [
        'export const enabledModules = [',
        "  'socle',",
        '] as const satisfies readonly AvailableModuleId[]',
        '',
      ].join('\n'),
    )
  })

  it('sur une liste multiligne à virgule finale : activer puis désactiver', () => {
    // Le sens que l'aller-retour du dépôt ne couvre pas : la liste réelle tient
    // sur une ligne aujourd'hui, donc ce cas y est vert par accident de
    // configuration. Éprouvé ici sur une liste qui ne dépend d'aucun état.
    expect(
      roundTrip(trailingComma, ['socle', 'facturation', 'roadmap'], ['socle', 'facturation']),
    ).toBe(trailingComma)
  })

  const endOfLineComment = [
    'export const enabledModules = [',
    "  'socle',",
    "  'facturation', // coupable en démo",
    "  'roadmap',",
    '] as const',
    '',
  ].join('\n')

  it('le commentaire de fin de ligne part avec l’entrée qu’il explique', () => {
    // Le laisser en place le réattribue au module précédent : le fichier ne perd
    // pas une ligne, il en documente un autre. C'est un mensonge, et l'aller-retour
    // ne le défait pas.
    expect(write(endOfLineComment, ['socle', 'roadmap'])).toBe(
      [
        'export const enabledModules = [',
        "  'socle',",
        "  'roadmap',",
        '] as const',
        '',
      ].join('\n'),
    )
  })

  it('sur un fichier en CRLF, la ligne insérée est en CRLF', () => {
    const crlf = trailingComma.replaceAll('\n', '\r\n')
    const written = write(crlf, ['socle', 'facturation', 'roadmap'])

    // Un « \n » écrit en dur au milieu d'un fichier en CRLF rend un fichier aux
    // fins de ligne mélangées.
    expect(written).not.toMatch(/[^\r]\n/)
    expect(written).toBe(
      [
        'export const enabledModules = [',
        "  'socle',",
        "  'facturation',",
        "  'roadmap',",
        '] as const satisfies readonly AvailableModuleId[]',
        '',
      ].join('\r\n'),
    )
  })

  it('une liste vidée puis regarnie retrouve sa forme multiligne', () => {
    // Une liste vide ne dit plus rien de ce que portait sa dernière entrée. Ce
    // qui subsiste — le crochet fermant sur sa propre ligne — suffit à savoir
    // qu'elle était multiligne, et à y réinsérer une entrée à son indentation.
    // La virgule finale, elle, est la convention du dépôt, réappliquée.
    const single = [
      'export const enabledModules = [',
      "  'socle',",
      '] as const',
      '',
    ].join('\n')
    const emptied = write(single, [])

    expect(emptied).toContain('[\n]')
    expect(write(emptied, ['socle'])).toBe(single)
  })

  const singleLineMultiple =
    "export const enabledModules = ['demo-enabled', 'demo-disabled'] as const\n"

  it('sur une liste d’une ligne : retirer le premier ne laisse pas d’espace parasite', () => {
    expect(write(singleLineMultiple, ['demo-disabled'])).toBe(
      "export const enabledModules = ['demo-disabled'] as const\n",
    )
  })

  it('sur une liste d’une ligne : retirer le dernier ne laisse pas de virgule parasite', () => {
    expect(write(singleLineMultiple, ['demo-enabled'])).toBe(
      "export const enabledModules = ['demo-enabled'] as const\n",
    )
  })
})

/**
 * Ce que l'écriture doit garantir même sur une mise en forme qu'elle n'a pas
 * choisie : le fichier rendu **s'analyse**. Un fichier invalide écrit sur disque
 * rend la commande définitivement impossible sur ce dépôt, et l'échec accuse
 * l'étape suivante plutôt que celui qui l'a produit.
 */
describe('l’écriture ne rend jamais un fichier que TypeScript ne sait plus lire', () => {
  const glued = [
    'export const enabledModules = [',
    "  'socle', // le socle, jamais coupé",
    "  'facturation'] as const satisfies readonly AvailableModuleId[]",
    '',
  ].join('\n')

  it('sur un crochet fermant collé à la dernière entrée, le commentaire n’avale pas ce qui suit', () => {
    // `'facturation'] as const` est une mise en forme légale, qu'une main écrit.
    // Sans retour à la ligne après le commentaire de fin de ligne, le crochet
    // fermant et la clause `satisfies` passent **dans** le commentaire : le
    // fichier ne compile plus, et plus aucune bascule n'est possible ensuite.
    expect(write(glued, ['socle'])).toBe(
      [
        'export const enabledModules = [',
        "  'socle' // le socle, jamais coupé",
        '] as const satisfies readonly AvailableModuleId[]',
        '',
      ].join('\n'),
    )
  })

  it('déplacer une entrée à commentaire de fin de ligne ne colle pas la suivante derrière', () => {
    // Le séparateur d'une position ne suit pas l'entrée qui s'y installe : une
    // entrée commentée arrivée sur une position d'une liste d'une seule ligne
    // se ferait suivre d'un espace, et la suite du fichier serait commentée.
    const written = write("export const enabledModules = ['socle', 'facturation', // la facturation\n  'roadmap'] as const\n", [
      'facturation',
      'socle',
      'roadmap',
    ])

    expect(readEnabledModules(written)).toEqual(['facturation', 'socle', 'roadmap'])
  })

  it('refuse d’enregistrer un fichier que TypeScript ne sait pas analyser', () => {
    // La relecture de la liste ne suffit **pas** : la récupération d'erreur de
    // TypeScript rend la liste demandée sur un texte qui ne compile pas — c'est
    // elle qui a laissé passer un « ] as const » commenté. Le rendu est donc
    // confronté aux diagnostics de syntaxe, et le fichier reste intact.
    const broken = [
      'export const enabledModules = [',
      "  'socle',",
      '] as const',
      '',
      'export function garde( {',
      '',
    ].join('\n')

    expect(readEnabledModules(broken)).toEqual(['socle'])
    expect(() => write(broken, [])).toThrowError(FeaturesFileError)
  })
})

/**
 * Un commentaire appartient à l'entrée qu'il explique, où qu'il soit écrit —
 * au-dessus, devant, derrière. Deux fautes sont interdites : le laisser
 * documenter le **mauvais** module, et le supprimer sans le dire.
 */
describe('les commentaires de bloc appartiennent à une entrée, jamais à une place', () => {
  it('celui qui précède une entrée sur sa ligne part avec elle, et est signalé', () => {
    // Le laisser en place l'attribuerait à « beta » : le fichier documenterait
    // le mauvais module, et rien ne l'annoncerait.
    const edit = writeEnabledModules(
      "export const enabledModules = [/* le pilote */ 'alpha', 'beta'] as const\n",
      ['beta'],
    )

    expect(edit.text).toBe("export const enabledModules = ['beta'] as const\n")
    expect(edit.droppedComments).toEqual(['alpha'])
  })

  it('celui qui sépare deux entrées appartient à celle qui le suit', () => {
    // Il explique « beta » : retirer « alpha » ne doit ni le supprimer, ni le
    // faire glisser sur une autre entrée.
    expect(
      write("export const enabledModules = ['alpha', /* le pilote */ 'beta'] as const\n", ['beta']),
    ).toBe("export const enabledModules = [/* le pilote */ 'beta'] as const\n")
  })

  it('celui qui suit la dernière entrée part avec elle, et est signalé', () => {
    const edit = writeEnabledModules(
      "export const enabledModules = ['alpha', 'beta' /* le dernier */] as const\n",
      ['alpha'],
    )

    expect(edit.text).toBe("export const enabledModules = ['alpha'] as const\n")
    expect(edit.droppedComments).toEqual(['beta'])
  })

  it('celui qui suit la dernière entrée reste devant la virgule qu’un ajout crée', () => {
    // Sans virgule dans le fichier, ce commentaire est écrit **avant** celle
    // qu'une entrée ajoutée rendra nécessaire. Le ranger derrière la virgule le
    // collerait à la nouvelle entrée : « alpha » perdrait le sien, « beta »
    // hériterait d'une explication qui ne le décrit pas.
    expect(
      write("export const enabledModules = ['alpha' /* le pilote */] as const\n", [
        'alpha',
        'beta',
      ]),
    ).toBe("export const enabledModules = ['alpha' /* le pilote */, 'beta'] as const\n")
  })

  it('celui qui sépare une entrée de sa virgule est signalé lui aussi', () => {
    const edit = writeEnabledModules(
      "export const enabledModules = ['alpha' /* le pilote */, 'beta'] as const\n",
      ['beta'],
    )

    expect(edit.text).toBe("export const enabledModules = ['beta'] as const\n")
    expect(edit.droppedComments).toEqual(['alpha'])
  })

  it('celui qui n’appartient à aucune entrée survit à une liste vidée', () => {
    // Écrit sur la ligne du crochet ouvrant, il ne décrit aucune entrée en
    // particulier : personne ne l'emporte, donc personne ne le supprime.
    const source = [
      'export const enabledModules = [ /* la configuration du dépôt */',
      "  'alpha',",
      '] as const',
      '',
    ].join('\n')

    expect(write(source, [])).toContain('/* la configuration du dépôt */')
  })

  it('l’aller-retour rend le fichier identique sur chacune de ces places', () => {
    for (const source of [
      "export const enabledModules = [/* le pilote */ 'alpha', 'beta'] as const\n",
      "export const enabledModules = ['alpha', /* le pilote */ 'beta'] as const\n",
      "export const enabledModules = ['alpha', 'beta' /* le dernier */] as const\n",
      "export const enabledModules = ['alpha' /* le pilote */, 'beta'] as const\n",
    ]) {
      expect(write(source, ['alpha', 'beta'])).toBe(source)
    }
  })
})
