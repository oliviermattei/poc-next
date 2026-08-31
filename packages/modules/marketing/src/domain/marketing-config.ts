import { z } from 'zod'

/**
 * La configuration du site public, et ce qu'elle a le droit de dire.
 *
 * Une configuration est une **frontière** au même titre qu'un corps de requête
 * (`docs/security.md` §4) : elle est écrite à la main par le propriétaire du
 * projet, elle peut être fausse, et une configuration fausse ne doit pas
 * produire une page à moitié affichée — elle doit être **refusée en nommant la
 * section fautive**. Zod juge la forme, les règles croisées ci-dessous jugent
 * ce qu'une forme valide peut encore avoir d'incohérent.
 *
 * Ce fichier est du `domain` : aucun framework, aucun ORM, aucun React. `zod`
 * y est explicitement admis (`tooling/eslint/boundaries.ts`, commentaire de
 * `domainForbiddenSources`) — c'est une bibliothèque pure, et un type de valeur
 * validé appartient au domaine.
 */

/** L'identifiant du module, écrit **une fois** : le contrat et les clés le partagent. */
export const MARKETING_MODULE_ID = 'marketing' as const

/**
 * Les natures de section que le site sait afficher.
 *
 * Fermée, et c'est le point : une nature inconnue dans la configuration est un
 * bloc que personne n'affichera. La refuser au démarrage vaut mieux que de
 * l'ignorer en silence.
 */
export const SECTION_KINDS = [
  'hero',
  'features',
  'testimonials',
  'faq',
  'cta',
  // s11. Ni éléments, ni actions : cette section porte un **formulaire**, dont
  // la destination est une route du module et non un chemin de configuration.
  'newsletter',
] as const

export type MarketingSectionKind = (typeof SECTION_KINDS)[number]

/**
 * Les natures dont chaque **élément** porte son propre texte.
 *
 * Une section de cette famille sans élément n'affiche qu'un titre suivi de
 * rien : c'est l'« écran vide sans action » que le design system refuse.
 */
const ITEMISED_KINDS: readonly MarketingSectionKind[] = ['features', 'testimonials', 'faq']

/** Les natures qui portent un appel à l'action. Sans bouton, elles n'ont pas d'objet. */
const ACTIONABLE_KINDS: readonly MarketingSectionKind[] = ['hero', 'cta']

/** Identifiant stable : `kebab-case`, comme partout dans le dépôt. */
const identifier = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/, 'doit être un identifiant en kebab-case')

/** Identifiant d'action : `camelCase` accepté, ce sont des noms de clés. */
const actionIdentifier = z
  .string()
  .regex(/^[a-zA-Z][a-zA-Z0-9-]*$/, 'doit être un identifiant')

/**
 * La destination d'un bouton : un chemin **interne**, jamais une URL.
 *
 * Une configuration qui pourrait poser `https://…` sur un bouton de la page
 * d'accueil est une redirection ouverte à la main du premier fichier venu
 * (`docs/security.md` §4). Le refus porte donc sur la forme, pas sur une liste
 * de domaines : seul un chemin absolu du site est admis, et `//evil.test` — que
 * le navigateur lit comme une origine — ne l'est pas.
 */
const internalPath = z
  .string()
  .regex(/^\/(?!\/)[A-Za-z0-9\-._~/]*$/, 'doit être un chemin interne (« /inscription »)')

const actionSchema = z.object({
  id: actionIdentifier,
  href: internalPath,
  variant: z.enum(['default', 'outline']),
})

const sectionSchema = z.object({
  id: identifier,
  kind: z.enum(SECTION_KINDS),
  items: z.array(identifier).readonly().default([]),
  actions: z.array(actionSchema).readonly().default([]),
})

const legalDocumentSchema = z.object({
  slug: identifier,
  sections: z.array(identifier).readonly().default([]),
})

/**
 * Les seuils de la limitation de débit des formulaires publics
 * (`docs/security.md` §7 : « seuils configurables »).
 *
 * Entiers strictement positifs : un seuil à zéro serait un formulaire fermé
 * qui a l'air ouvert, et une fenêtre nulle ferait une division par zéro dans le
 * calcul de fenêtre. Les deux sont refusés en nommant la clé plutôt que d'être
 * corrigés en silence.
 */
const rateLimitSchema = z.object({
  windowSeconds: z.int().min(1),
  maxPerClient: z.int().min(1),
  maxPerForm: z.int().min(1),
})

/**
 * Les formulaires publics — **le destinataire du contact est ici, pas dans le
 * code**.
 *
 * C'est le piège que la story nomme : une adresse écrite en constante serait la
 * même dans tous les projets générés depuis ce boilerplate, et un propriétaire
 * ne pourrait la changer qu'en modifiant un module. `z.email()` refuse aussi ce
 * qu'un `to` d'email ne doit jamais porter — un retour à la ligne, donc une
 * injection d'en-tête (`docs/security.md` §4).
 *
 * `newsletterSource` alimente la colonne `source` de `public_subscription` : la
 * table est **partagée** avec la liste d'attente de s42, qui déclarera la
 * sienne. Deux modèles concurrents d'inscription sont exactement ce que la
 * story interdit.
 */
const formsSchema = z.object({
  contactRecipient: z.string().max(254).pipe(z.email()),
  newsletterSource: identifier,
  rateLimit: rateLimitSchema,
})

const configurationSchema = z.object({
  sections: z.array(sectionSchema).readonly(),
  legalDocuments: z.array(legalDocumentSchema).readonly(),
  forms: formsSchema,
})

export type MarketingAction = z.infer<typeof actionSchema>
export type MarketingSection = z.infer<typeof sectionSchema>
export type MarketingLegalDocument = z.infer<typeof legalDocumentSchema>
export type MarketingForms = z.infer<typeof formsSchema>
export type MarketingRateLimit = z.infer<typeof rateLimitSchema>
export type MarketingConfiguration = z.infer<typeof configurationSchema>

/**
 * La configuration **telle qu'on l'écrit**, avant application des valeurs par
 * défaut.
 *
 * C'est ce type que `config/marketing.ts` confronte par `satisfies`, et la
 * distinction n'est pas cosmétique : `items` et `actions` valent `[]` par
 * défaut, si bien que le type de sortie les rend obligatoires alors qu'une
 * section n'a aucune raison de déclarer une liste vide. Sans lui, écrire une
 * section `faq` obligerait à poser `actions: []` — la configuration
 * documenterait le schéma au lieu du site.
 */
export type MarketingConfigurationInput = z.input<typeof configurationSchema>

/**
 * Le refus, avec le nom de ce qui est fautif.
 *
 * Une classe à elle, comme `ModuleConfigurationError` de `@repo/core` : un
 * appelant doit pouvoir distinguer « la configuration du site est fausse » de
 * n'importe quelle autre panne, et le message doit nommer la section ou le
 * document en cause — sinon le propriétaire relit son fichier entier.
 */
export class MarketingConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MarketingConfigurationError'
  }
}

const quote = (value: string): string => `« ${value} »`

const refuse = (message: string): never => {
  throw new MarketingConfigurationError(`config/marketing.ts : ${message}`)
}

/**
 * Les règles qu'une forme valide peut encore violer.
 *
 * Elles sont ici et non dans le schéma parce qu'elles portent sur les
 * **relations** entre entrées — un doublon, une nature croisée avec son
 * contenu — et parce qu'un message de Zod nomme un chemin (`sections.1.items`)
 * là où le propriétaire a besoin d'un nom (`« faq »`).
 */
const assertCoherent = (configuration: MarketingConfiguration): void => {
  if (configuration.sections.length === 0) {
    refuse(
      'aucune section déclarée. Un site marketing activé sans section n’affiche rien ; ' +
        'pour ne pas servir de page publique, coupez le module (« pnpm ks toggle marketing »).',
    )
  }

  if (configuration.legalDocuments.length === 0) {
    refuse(
      'aucun document légal déclaré. Le pied de page est le point d’accès aux mentions ' +
        'légales, et un pied de page sans lien est un écran cassé.',
    )
  }

  const seenSections = new Set<string>()

  for (const section of configuration.sections) {
    if (seenSections.has(section.id)) {
      refuse(
        `deux sections portent l’identifiant ${quote(section.id)}. Il sert de clé de rendu ` +
          'et de préfixe de traduction : deux sections homonymes afficheraient le même texte.',
      )
    }

    seenSections.add(section.id)

    const itemised = ITEMISED_KINDS.includes(section.kind)

    if (itemised && section.items.length === 0) {
      refuse(
        `la section ${quote(section.id)} est de nature ${quote(section.kind)} et ne déclare ` +
          'aucun élément : elle afficherait un titre suivi de rien.',
      )
    }

    if (!itemised && section.items.length > 0) {
      refuse(
        `la section ${quote(section.id)} déclare des éléments qu’une section de nature ` +
          `${quote(section.kind)} n’affiche pas : ils seraient perdus en silence.`,
      )
    }

    const actionable = ACTIONABLE_KINDS.includes(section.kind)

    if (actionable && section.actions.length === 0) {
      refuse(
        `la section ${quote(section.id)} est de nature ${quote(section.kind)} et n’a aucune ` +
          'action : c’est précisément ce qu’elle existe pour porter.',
      )
    }

    if (!actionable && section.actions.length > 0) {
      refuse(
        `la section ${quote(section.id)} déclare des actions qu’une section de nature ` +
          `${quote(section.kind)} n’affiche pas.`,
      )
    }
  }

  const seenSlugs = new Set<string>()

  for (const document of configuration.legalDocuments) {
    if (seenSlugs.has(document.slug)) {
      refuse(
        `deux documents légaux portent le slug ${quote(document.slug)} : ils se disputeraient ` +
          'la même URL.',
      )
    }

    seenSlugs.add(document.slug)

    if (document.sections.length === 0) {
      refuse(
        `le document légal ${quote(document.slug)} ne déclare aucune section : la page ` +
          'n’aurait aucun contenu.',
      )
    }
  }
}

/**
 * La valeur qu'un chemin d'issue Zod désigne dans l'entrée brute.
 *
 * Sans elle, le refus d'une nature inconnue dit « attendu l'une de … » sans
 * jamais nommer ce qui a été écrit : le propriétaire relit son fichier au lieu
 * de lire le message. Rendue seulement pour une valeur simple — un objet
 * recopié dans un message ne se lit pas.
 */
const valueAt = (input: unknown, path: readonly PropertyKey[]): string | number | undefined => {
  let current: unknown = input

  for (const step of path) {
    if (current === null || typeof current !== 'object') {
      return undefined
    }

    current = (current as Record<PropertyKey, unknown>)[step]
  }

  return typeof current === 'string' || typeof current === 'number' ? current : undefined
}

/**
 * Valide une configuration et la rend telle qu'elle sera lue.
 *
 * L'entrée est `unknown` **volontairement** : ce que le compilateur garantit à
 * l'écriture de `config/marketing.ts` ne dit rien de ce que ce fichier vaut
 * après une édition à la main, et une frontière qui ne fait confiance qu'au
 * typage n'est pas une frontière.
 */
export function parseMarketingConfiguration(input: unknown): MarketingConfiguration {
  const result = configurationSchema.safeParse(input)

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => {
        const received = valueAt(input, issue.path)

        return (
          `  - ${issue.path.join('.') || '(racine)'} : ${issue.message}` +
          (received === undefined ? '' : ` (reçu : ${quote(String(received))})`)
        )
      })
      .join('\n')

    throw new MarketingConfigurationError(
      `config/marketing.ts est invalide :\n${details}\n` +
        `Natures de section acceptées : ${SECTION_KINDS.join(', ')}.`,
    )
  }

  assertCoherent(result.data)

  return result.data
}

/** Vrai si la nature de cette section affiche des éléments. Lu par la présentation. */
export const isItemised = (kind: MarketingSectionKind): boolean => ITEMISED_KINDS.includes(kind)
