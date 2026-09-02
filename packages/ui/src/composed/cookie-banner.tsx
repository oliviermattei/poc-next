import { Button } from '../components/button'
import { cn } from '../lib/cn'

/**
 * La bannière de consentement (s36), inventoriée par `docs/design-system.md`.
 *
 * Quatre propriétés, et chacune répond à une contrainte plutôt qu'à un goût :
 *
 * 1. **C'est un `<form method="post">` natif.** Aucun état React, aucun
 *    `fetch` : accepter et refuser marchent script coupé. C'est la seule
 *    surface du dépôt dont c'est vrai par construction, et c'est ce que le
 *    parcours mesure dans un contexte `javaScriptEnabled: false` ;
 * 2. **les deux boutons ont la même variante et la même taille.** Refuser doit
 *    être aussi facile qu'accepter — un refus relégué en lien discret ou
 *    derrière un écran de plus est précisément ce que la loi refuse. Le
 *    composant ne laisse pas le choix à son appelant : il n'expose pas de
 *    variante par bouton ;
 * 3. **elle n'est pas modale.** `role="region"`, pas de piège de focus, pas de
 *    voile : une bannière modale transforme « refuser » en « ne plus pouvoir
 *    lire la page » ;
 * 4. **rien en ligne.** Ni attribut `style`, ni `<style>`, ni `<script>` : la
 *    politique de sécurité du contenu livrée par s45 refuse les trois en
 *    production, et l'élévation se fait de toute façon par bordure et fond.
 *
 * Aucun texte n'est écrit ici : ce package ne connaît ni catalogue ni locale.
 */
export interface CookieBannerProps {
  /** Nom accessible de la région. Obligatoire : une région anonyme n'est pas annonçable. */
  readonly label: string
  readonly title: string
  readonly description: string
  /** L'URL de la route qui enregistre le choix. */
  readonly action: string
  readonly acceptLabel: string
  readonly refuseLabel: string
  /** Le libellé et la destination de la personnalisation par catégorie. */
  readonly customizeLabel: string
  readonly customizeHref: string
}

export function CookieBanner({
  label,
  title,
  description,
  action,
  acceptLabel,
  refuseLabel,
  customizeLabel,
  customizeHref,
}: CookieBannerProps) {
  return (
    <div
      role="region"
      aria-label={label}
      data-slot="cookie-banner"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background"
    >
      <form
        method="post"
        action={action}
        className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:gap-6"
      >
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-sm text-muted-foreground">{description}</p>
          <a
            href={customizeHref}
            className={cn(
              'w-fit rounded-sm text-sm text-muted-foreground underline underline-offset-4',
              'hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
            )}
          >
            {customizeLabel}
          </a>
        </div>

        {/* Même variante, même taille, même rang : c'est la symétrie qui fait la
            conformité, et elle n'est pas paramétrable. */}
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row md:ml-auto">
          <Button type="submit" name="decision" value="refuse-all" className="w-full sm:w-auto">
            {refuseLabel}
          </Button>
          <Button type="submit" name="decision" value="accept-all" className="w-full sm:w-auto">
            {acceptLabel}
          </Button>
        </div>
      </form>
    </div>
  )
}
