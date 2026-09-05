import { cn } from '../lib/cn'
import type { ComponentProps, ReactNode } from 'react'

/**
 * L'échelle de prose, rendue.
 *
 * **Elle vit ici, et pas dans le module qui l'a livrée** (ADR 055). s29 l'avait
 * posée dans `@repo/module-blog/presentation` ; s30 en a eu besoin pour la
 * documentation, et un module optionnel qui en héberge un autre n'a que deux
 * suites — `requires: ['blog']` sur la documentation (ADR 018), c'est-à-dire un
 * produit où `pnpm ks toggle blog` refuse tant que la documentation est
 * activée, ou une seconde typographie. C'est ici que le design system vit en
 * code : `docs/design-system.md` § « Échelle de prose » est la décision, ce
 * fichier en est la transcription, comme `styles.css` l'est des tokens.
 *
 * Le corps d'un article est du MDX compilé en composants React (ADR 053) : ses
 * éléments arrivent ici **sans classe**, et c'est cette table qui leur en
 * donne. C'est aussi ce qui permet de refuser `@tailwindcss/typography`, dont
 * l'échelle typographique serait une seconde autorité à côté du design system.
 *
 * Chaque entrée est **dérivée** d'un rôle ou d'un jeton déjà déclaré dans
 * `docs/design-system.md` (§ « Échelle de prose ») : aucune taille, aucune
 * graisse, aucune couleur, aucun rayon n'est inventé ici. Le document fait
 * autorité ; ce fichier en est la transcription, comme `styles.css` l'est des
 * tokens.
 *
 * **`h1` est rendu en `<h2>`**, et c'est un choix : le `h1` de la page est le
 * titre de l'article. Un `#` en tête de corps produirait un second `h1`, ce
 * qu'aucun lecteur d'écran ne sait interpréter. Le niveau visuel reste celui du
 * rôle `h2`.
 */
// `cn(` n'est pas décoratif : c'est l'un des trois contextes où
// `tests/i18n.test.ts` reconnaît une liste de classes plutôt qu'une phrase.
const heading2 = cn('mt-10 scroll-mt-20 text-2xl font-semibold tracking-tight first:mt-0')

/**
 * Le texte d'un titre, tel qu'il arrive du MDX.
 *
 * Les enfants d'un `##` sont des chaînes, mais pas seulement : `## Le \`contrat\``
 * arrive en tableau, dont un `<code>`. Cette fonction ne connaît que ce que le
 * contenu livré emploie — chaînes, nombres, tableaux, et les enfants d'un
 * élément. Un titre portant autre chose (une image, un composant) rendrait une
 * ancre partielle ; le sommaire, lui, dérive du **même** texte par la même
 * fonction du module, donc les deux resteraient d'accord.
 */
const textOf = (node: ReactNode): string => {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node)
  }

  if (Array.isArray(node)) {
    return node.map((child) => textOf(child as ReactNode)).join('')
  }

  const children = (node as { props?: { children?: ReactNode } } | null)?.props?.children

  return children === undefined ? '' : textOf(children)
}

/**
 * L'échelle de prose, **paramétrée par une seule chose** : l'ancre d'un titre.
 *
 * La documentation (s30) a besoin d'un `id` sur ses `h2` et `h3` — sans lui, son
 * sommaire pointerait vers des fragments que la page ne rend pas. Le blog n'en
 * a pas. Sans ce paramètre, la documentation devrait redéclarer les classes des
 * titres, c'est-à-dire une seconde typographie par la porte de derrière.
 *
 * **Sur `h2` et `h3`, et sur eux seuls** : ce sont les niveaux dont un sommaire
 * se dérive. Un `id` sur `h1` en collerait un second, identique, sous une entrée
 * de sommaire qui ne le nomme pas.
 *
 * `scroll-mt-20` était déjà là avant qu'aucune ancre n'existe : c'est la marge
 * qui empêche un titre rejoint par un fragment de se coller au bord haut.
 */
export interface ProseOptions {
  /**
   * Donne son ancre à un titre, depuis son texte. Absent : aucun `id`.
   *
   * C'est l'appelant qui la fournit, et non ce package : le sommaire est dérivé
   * de la **source** Markdown par le module qui la lit, et les deux doivent
   * employer la même fonction, sans quoi les ancres et le sommaire divergent.
   */
  readonly headingId?: (text: string) => string
}

export function createProseComponents({ headingId }: ProseOptions = {}) {
  const anchored = (props: { readonly children?: ReactNode }): { id?: string } =>
    headingId === undefined ? {} : { id: headingId(textOf(props.children)) }

  return {
  /*
   * **Sans ancre, et c'est la contrepartie du rendu en `<h2>`.** Le sommaire
   * d'une page est dérivé des niveaux 2 et 3 de la source : aucune entrée ne
   * nomme jamais l'ancre d'un `#`. Lui en poser une ne servait donc personne, et
   * un corps portant `# Titre` puis `## Titre` livrait deux fois le même `id` —
   * le lien du sommaire tombait sur celui qu'il ne nomme pas, et le refus de
   * `parseDocsPage` ne voyait rien, puisqu'il compte les ancres du sommaire.
   * `tests/docs.test.ts` tient les deux passes sur le même ensemble de niveaux.
   */
  h1: (props: ComponentProps<'h2'>) => <h2 className={heading2} {...props} />,
  h2: (props: ComponentProps<'h2'>) => <h2 className={heading2} {...anchored(props)} {...props} />,
  h3: (props: ComponentProps<'h3'>) => (
    <h3
      className="mt-8 scroll-mt-20 text-xl font-semibold tracking-tight"
      {...anchored(props)}
      {...props}
    />
  ),
  h4: (props: ComponentProps<'h4'>) => <h4 className="mt-6 text-base font-semibold" {...props} />,
  p: (props: ComponentProps<'p'>) => <p className="text-base leading-7" {...props} />,
  ul: (props: ComponentProps<'ul'>) => (
    <ul className="list-disc space-y-2 pl-6 text-base leading-7" {...props} />
  ),
  ol: (props: ComponentProps<'ol'>) => (
    <ol className="list-decimal space-y-2 pl-6 text-base leading-7" {...props} />
  ),
  blockquote: (props: ComponentProps<'blockquote'>) => (
    <blockquote
      className="border-l-2 border-border pl-4 text-base leading-7 text-muted-foreground"
      {...props}
    />
  ),
  a: (props: ComponentProps<'a'>) => (
    // Le soulignement porte l'affordance, pas une couleur : les quatre
    // variantes sémantiques passent sous le seuil WCAG AA en thème clair
    // (`s49-contraste-des-alertes`), et un lien n'est de toute façon pas un état
    // métier.
    <a className="underline underline-offset-4" {...props} />
  ),
  code: (props: ComponentProps<'code'>) => (
    <code className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-sm" {...props} />
  ),
  pre: (props: ComponentProps<'pre'>) => (
    // Le seul défilement horizontal que le design system autorise, et il le
    // nomme : « réservé aux blocs de code de la documentation ».
    <pre
      className="overflow-x-auto rounded-lg border border-border bg-muted p-4 font-mono text-sm [&_code]:bg-transparent [&_code]:p-0"
      {...props}
    />
  ),
  /*
   * Le corps d'un article est du MDX : l'auteur écrit `![alt](src)`, il ne
   * choisit pas un composant, et les dimensions ne sont pas connues à la
   * compilation. Un module ne dépend de toute façon pas de Next — `next/image`
   * n'y est pas importable — et la règle `@next/next/no-img-element` ne
   * s'applique pas ici, elle ne vise que `apps/web`.
   */
  img: (props: ComponentProps<'img'>) => (
    <img className="w-full rounded-lg border border-border" {...props} alt={props.alt ?? ''} />
  ),
  hr: (props: ComponentProps<'hr'>) => <hr className="border-border" {...props} />,
  }
}

/** L'échelle sans ancre — celle du blog, et le défaut pour tout corps sans sommaire. */
export const proseComponents = createProseComponents()

/**
 * La largeur de lecture du corps — manque n°4 du design, tranché dans le système.
 *
 * **Elle n'est pas toujours la borne qui décide.** Mesuré au navigateur sur une
 * page de documentation (s30) : le corps fait 358 px à 390, 464 px à 768 et
 * 448 px à 1440 — plus étroit sur l'écran le plus large, parce que la coquille
 * borne à `max-w-4xl` et que la grille à trois colonnes s'y partage. Les 672 px
 * de `max-w-2xl` n'y sont donc jamais atteints. Sur un article de blog, en une
 * colonne, ils le sont. Le détail et la décision de ne pas élargir la coquille
 * sont dans `docs/designs/s30-docs-site.md` § Manques du design system.
 */
export const PROSE_CLASSNAME = cn('max-w-2xl space-y-4')
