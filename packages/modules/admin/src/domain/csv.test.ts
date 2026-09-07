import { describe, expect, it } from 'vitest'

import { CSV_CONTENT_TYPE, FORMULA_STARTERS, toCsv } from './csv'

/**
 * **L'écriture CSV, mesurée sur le fichier produit** (s37c).
 *
 * Il n'existait aucun écrivain CSV dans ce dépôt, donc aucun assainisseur
 * d'injection de formule : c'est la surface de sécurité que **ce fichier**
 * porte, et elle est réelle — une cellule dont le premier caractère est `=`,
 * `+`, `-` ou `@` est exécutée par un tableur à l'ouverture. Ces adresses
 * viennent d'inconnus : c'est une entrée hostile qui traverse un fichier que
 * quelqu'un ouvrira sur son poste, hors de tout navigateur et de toute CSP.
 *
 * Ce n'est **pas** la seule de la story, et l'écrire ici enverrait chercher au
 * mauvais endroit : le refus opposé à qui n'administre pas est mesuré dans
 * `tests/admin.test.ts`, et le nom de fichier qui ne recopie jamais la
 * recherche dans un en-tête l'est dans `domain/back-office.test.ts`.
 *
 * Tout est éprouvé sur la **chaîne rendue**, jamais sur une intention : c'est le
 * fichier qui sera ouvert, pas le commentaire qui l'accompagne.
 */

/** Les lignes du fichier, sans la marque d'ordre des octets ni la ligne finale vide. */
const linesOf = (csv: string): readonly string[] =>
  csv.replace('﻿', '').split('\r\n').slice(0, -1)

describe('l’écriture d’un fichier CSV', () => {
  it('rend une ligne par rangée, terminée en CRLF, et cite chaque cellule', () => {
    const csv = toCsv([
      ['adresse', 'source'],
      ['ada@example.test', 'newsletter'],
    ])

    expect(linesOf(csv)).toEqual(['"adresse";"source"', '"ada@example.test";"newsletter"'])
    // La marque d'ordre des octets : sans elle, un tableur ouvre un fichier
    // UTF-8 en interprétant les accents dans son encodage local.
    expect(csv.startsWith('﻿')).toBe(true)
    expect(CSV_CONTENT_TYPE).toContain('charset=utf-8')
  })

  it('ne laisse ni point-virgule, ni guillemet, ni saut de ligne casser une ligne', () => {
    const csv = toCsv([['a;b'], ['c"d'], ['e\nf'], ['i']])

    // Quatre rangées entrées, quatre lignes sorties : un séparateur ou un saut
    // de ligne dans une cellule n'en crée aucune de plus.
    expect(linesOf(csv)).toHaveLength(4)
    expect(linesOf(csv)[0]).toBe('"a;b"')
    // Le guillemet est **doublé**, la forme de RFC 4180 : l'échapper par une
    // barre oblique produirait un fichier qu'aucun tableur ne relit.
    expect(linesOf(csv)[1]).toBe('"c""d"')
  })

  /**
   * **Ce que ce fichier ne fait pas, dit plutôt que sous-entendu** : un retour
   * chariot suivi d'un saut de ligne **à l'intérieur** d'une cellule reste
   * dedans, entre guillemets — c'est ce que RFC 4180 prescrit, et un lecteur
   * naïf qui découperait sur CRLF y verrait deux lignes. Aucune donnée exportée
   * par cette story n'en contient (une adresse est validée par Zod, une source
   * et une langue viennent de la configuration), et transformer la valeur pour
   * arranger un lecteur naïf serait abîmer la donnée en silence.
   */
  it('garde un CRLF interne dans sa cellule, entre guillemets', () => {
    expect(toCsv([['g\r\nh']])).toBe('\uFEFF"g\r\nh"\r\n')
  })

  /**
   * **L'injection de formule**, et c'est la raison d'être de ce fichier.
   *
   * Le balayage est **dérivé de la production** : la liste d'amorces est
   * importée, jamais recopiée, sinon une amorce ajoutée à côté ne serait
   * balayée par rien. Aucun nombre n'est écrit ici pour la même raison — il
   * vieillirait à côté d'elle.
   *
   * Rien ne prétend que la liste est complète : c'est ce qui a été balayé, pas
   * ce qu'un tableur pourrait exécuter. Ce que la dérivation ne tient pas, en
   * revanche, c'est le retrait d'une amorce — la boucle en balaierait une de
   * moins et resterait verte. D'où le **plancher** ci-dessous : les caractères
   * que l'OWASP nomme sont exigés, et les retirer de la production rougit.
   *
   * L'assainissement est un **préfixe apostrophe** : le tableur affiche alors la
   * valeur telle quelle au lieu de l'évaluer. Le citer ne suffit pas — `"=1+1"`
   * est lu comme le texte `=1+1`, que le tableur évalue quand même.
   */
  it('neutralise une cellule qui commencerait une formule, dans le fichier rendu', () => {
    // Le plancher, et l'anti-vacuité du même geste : une liste vide ou amputée
    // rendrait la boucle verte en ne lisant rien de dangereux.
    for (const requise of ['=', '+', '-', '@']) {
      expect(FORMULA_STARTERS, requise).toContain(requise)
    }

    for (const amorce of FORMULA_STARTERS) {
      const hostile = `${amorce}HYPERLINK("http://pirate.test")`
      const [ligne = ''] = linesOf(toCsv([[hostile]]))

      // Ce que le fichier porte : la valeur, précédée de l'apostrophe.
      expect(ligne, amorce).toBe(`"'${hostile.replaceAll('"', '""')}"`)
      // Et ce qu'il ne porte **pas** : une cellule qui s'ouvre sur l'amorce.
      expect(ligne.startsWith(`"${amorce}`), amorce).toBe(false)
    }
  })

  it('laisse intacte une cellule qui ne commence aucune formule', () => {
    // L'apostrophe n'est pas posée partout : elle salirait chaque adresse, et
    // un assainisseur qui abîme tout finit par être retiré.
    expect(linesOf(toCsv([['ada@example.test']]))[0]).toBe('"ada@example.test"')
    // Le caractère dangereux **au milieu** n'amorce rien.
    expect(linesOf(toCsv([['a=b']]))[0]).toBe('"a=b"')
  })

  it('rend un fichier vide de lignes plutôt que rien du tout', () => {
    // Une sélection sans résultat produit un fichier avec son en-tête : un
    // fichier de zéro octet se lit comme un téléchargement en échec.
    expect(linesOf(toCsv([['adresse']]))).toEqual(['"adresse"'])
  })
})
