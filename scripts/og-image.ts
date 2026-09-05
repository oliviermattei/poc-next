import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'

/**
 * **Le générateur de l'image Open Graph par défaut** (s53).
 *
 * ## La décision, et pourquoi elle est écrite ici
 *
 * L'image de partage par défaut est un **fichier statique unique**,
 * `apps/web/public/og-default.png`, et non un gabarit rendu à la requête.
 * `next/og` n'existe nulle part dans le dépôt, et le design system n'a **ni
 * gabarit d'image sociale, ni dimensions, ni jetons applicables** — c'est le
 * manque n°2 signalé par `docs/designs/s29-blog-mdx.md`. Inventer un gabarit
 * pour combler ce manque serait exactement la dérive que `AGENTS.md` refuse :
 * un manque du design system se **signale**, il ne se comble pas en passant.
 *
 * Ce script n'invente donc rien : il compose **les jetons existants** de
 * `packages/ui/src/styles.css` (`--background`, `--foreground`,
 * `--muted-foreground`, `--border`, `--radius`) et la typographie du système
 * (Geist Sans), avec les textes du catalogue de l'application. Aucune couleur,
 * aucune graisse, aucun rayon qui ne soit déjà dans le système.
 *
 * ## Pourquoi une image statique plutôt qu'un gabarit à la requête
 *
 * - **La politique de sécurité du contenu ne gagne aucune origine** : l'image
 *   est servie par l'application, comme les polices. Un service d'images tiers
 *   demanderait une origine dans `config/security.ts`, donc une justification
 *   écrite (`docs/security.md` §1) ;
 * - un gabarit rendu à la requête suppose un dessin — hiérarchie, marges,
 *   troncature d'un titre long, jeu de couleurs — que le design system ne
 *   décrit pas. Le dessiner ici l'inventerait ;
 * - un article **peut** fournir la sienne (`image:` au frontmatter) : le défaut
 *   n'est le sujet que des articles qui n'en ont pas.
 *
 * ## Ce que le design system ne couvre toujours pas, après cette story
 *
 * Un **gabarit d'image sociale** : dimensions de référence, zone de titre,
 * marges de sécurité, comportement d'un titre long, variante sombre. Tant qu'il
 * n'existe pas, une image par article ne peut pas être produite sans inventer.
 *
 * **Quatre dimensions sont donc posées ici et nulle part ailleurs** — titre
 * 88 px, sous-titre 36 px, marge et retrait 64 px, interligne 24 px : aucune ne
 * dérive des huit rôles typographiques du système (`display`, le plus grand,
 * est réservé au héros marketing) ni de son échelle d'espacement, pensée pour
 * un écran et non pour un cadre de 1200×630. Elles sont **nommées dans
 * `docs/design-system.md`**, section « Image sociale », pour que la prochaine
 * story parte du manque au lieu de le redécouvrir. Les couleurs, le rayon et la
 * police, eux, restent lus dans le système.
 *
 * ## Reproduire l'image
 *
 * `npx tsx scripts/og-image.ts`. Le rendu est fait par Chromium (déjà installé
 * pour les parcours) : la police et les jetons sont ceux du dépôt, donc l'image
 * suit un changement de jeton au lieu d'être un binaire orphelin.
 */

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

/** Les dimensions que les réseaux attendent d'une image `og:image` (1,91:1). */
const WIDTH = 1200
const HEIGHT = 630

/** Les jetons lus **dans le fichier du design system**, jamais recopiés. */
const tokenOf = (name: string): string => {
  const styles = readFileSync(join(REPO_ROOT, 'packages/ui/src/styles.css'), 'utf8')
  const matched = new RegExp(`^\\s*--${name}:\\s*([^;]+);`, 'm').exec(styles)

  if (matched?.[1] === undefined) {
    throw new Error(`Jeton « --${name} » introuvable dans packages/ui/src/styles.css.`)
  }

  return matched[1].trim()
}

const messageOf = (key: string): string => {
  const catalogue = JSON.parse(
    readFileSync(join(REPO_ROOT, 'apps/web/messages/fr.json'), 'utf8'),
  ) as Record<string, string>
  const value = catalogue[key]

  if (value === undefined) {
    throw new Error(`Clé « ${key} » absente du catalogue de l’application.`)
  }

  return value
}

/**
 * La police du design system, prise **dans le paquet installé**.
 *
 * Ni `import.meta.resolve` ni `require.resolve` n'y mènent : la carte `exports`
 * de `geist` ne déclare ni ses fichiers de police, ni son `package.json` — seul
 * `next/font` les lit, à la construction. Le chemin est donc joint à la main,
 * et **vérifié** : une montée de version qui déplacerait le fichier arrête ce
 * script en le nommant, plutôt que de rendre une image sans typographie.
 */
const fontPath = join(
  REPO_ROOT,
  'apps/web/node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2',
)

if (!existsSync(fontPath)) {
  throw new Error(`Police du design system introuvable : ${fontPath}`)
}

const pageDocument = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      @font-face {
        font-family: 'Geist';
        src: url('file://${fontPath}') format('woff2');
        font-weight: 100 900;
      }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body {
        width: ${WIDTH}px;
        height: ${HEIGHT}px;
        background: ${tokenOf('background')};
        color: ${tokenOf('foreground')};
        font-family: 'Geist', system-ui, sans-serif;
        display: flex;
        align-items: center;
      }
      main {
        margin: 64px;
        padding: 64px;
        border: 1px solid ${tokenOf('border')};
        border-radius: calc(${tokenOf('radius')} * 2);
        width: 100%;
        height: calc(100% - 128px);
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 24px;
      }
      h1 { font-size: 88px; font-weight: 600; letter-spacing: -0.03em; }
      p { font-size: 36px; color: ${tokenOf('muted-foreground')}; }
    </style>
  </head>
  <body>
    <main>
      <h1>${messageOf('app.metadata.title')}</h1>
      <p>${messageOf('app.metadata.description')}</p>
    </main>
  </body>
</html>`

const output = join(REPO_ROOT, 'apps/web/public/og-default.png')

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } })

await page.setContent(pageDocument, { waitUntil: 'load' })
// La police est chargée depuis le disque : sans cette attente, la capture peut
// tomber avant le premier rendu avec la typographie du design system.
await page.evaluate(async () => {
  await window.document.fonts.ready
})

mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, await page.screenshot({ type: 'png' }))
await browser.close()

console.log(`Image Open Graph écrite : ${output} (${WIDTH}×${HEIGHT})`)
