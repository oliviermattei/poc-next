import { createMDX } from 'fumadocs-mdx/next'

const withMDX = createMDX()

/**
 * **Le Guide est un site statique** (ADR 083) : `next build` écrit tout dans
 * `out/`, publiable sur n'importe quel hébergeur de fichiers, et rien ne tourne
 * côté serveur. D'où ce que ce fichier ne contient pas — ni `redirects()`, ni
 * `headers()`, ni proxy : l'export statique ne les sert pas. La racine `/`
 * redirige vers `/fr/` depuis `app/page.tsx`.
 *
 * `.mjs` et non `.ts` : Fumadocs MDX est un paquet ESM seul.
 *
 * @type {import('next').NextConfig}
 */
const config = {
  output: 'export',
  reactStrictMode: true,
  trailingSlash: true,
  images: { unoptimized: true },
}

export default withMDX(config)
