import { cn } from '@repo/ui'
import type { ComponentProps } from 'react'

/**
 * L'échelle de prose, rendue.
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

export const proseComponents = {
  h1: (props: ComponentProps<'h2'>) => <h2 className={heading2} {...props} />,
  h2: (props: ComponentProps<'h2'>) => <h2 className={heading2} {...props} />,
  h3: (props: ComponentProps<'h3'>) => (
    <h3 className="mt-8 scroll-mt-20 text-xl font-semibold tracking-tight" {...props} />
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

/** La largeur de lecture du corps — manque n°4 du design, tranché dans le système. */
export const PROSE_CLASSNAME = cn('max-w-2xl space-y-4')
