/**
 * Le noyau de langue du dépôt : **une** règle de choix de locale, et la mise en
 * forme d'un catalogue.
 *
 * Il vit ici, à côté du registre, pour la raison qui a mis `satisfiesProtection`
 * dans `protection.ts` : la règle est lue par plusieurs appelants qui n'ont rien
 * en commun — la requête entrante, le sélecteur de langue, l'envoi d'un email —
 * et deux implémentations divergeraient au premier cas limite. Ce fichier est
 * pur : ni framework, ni ORM, ni lecture d'environnement.
 *
 * Il ne sait pas que le module `i18n` existe, et c'est ce qui rend la fonction
 * de résolution **identique dans les deux états** : module coupé, la liste des
 * locales servies se réduit à la locale par défaut, et le même appel rend le
 * même résultat. Un module écrit après s09 n'a donc aucune branche à porter.
 */

/** Une locale livrée par le projet, telle que `config/i18n.ts` la déclare. */
export type Locale = string

export interface LocaleChoice {
  /** Les locales que le projet **sert**, dans l'état de configuration courant. */
  readonly locales: readonly Locale[]
  /** Celle qui décide quand la demande n'aboutit pas. */
  readonly defaultLocale: Locale
  /**
   * La langue demandée, ou connue du destinataire. `null` / `undefined` est le
   * cas explicite du **destinataire sans compte** — invitation, guest checkout,
   * liste d'attente : rien n'est connu de lui, il reçoit la langue du site.
   */
  readonly candidate: string | null | undefined
}

/**
 * La locale à servir. **Une seule règle**, pour tout écran et tout email,
 * présents et futurs.
 *
 * Un repli silencieux sur la locale par défaut est voulu ici, et il n'a rien à
 * voir avec le repli interdit sur une clé de traduction manquante : une locale
 * inconnue vient de l'extérieur (une URL, un cookie, un en-tête), une clé
 * manquante vient du code.
 */
export function resolveLocale({ locales, defaultLocale, candidate }: LocaleChoice): Locale {
  return typeof candidate === 'string' && locales.includes(candidate) ? candidate : defaultLocale
}

/** Traductions plates telles que les modules et l'application les déclarent. */
export type FlatMessages = Readonly<Record<string, string>>

/** Traductions imbriquées, la forme que les bibliothèques d'i18n consomment. */
export interface NestedMessages {
  readonly [segment: string]: string | NestedMessages
}

/**
 * Déplie `{'auth.signIn.title': '…'}` en `{auth: {signIn: {title: '…'}}}`.
 *
 * Les catalogues du dépôt sont **plats** : c'est la forme du contrat de module
 * (`ModuleMessages`), et celle que `qualifyMessageKey` produit en préfixant par
 * le module. La plupart des bibliothèques attendent l'autre. La conversion est
 * faite ici, une fois, plutôt que dans chaque module.
 *
 * Une collision — `a.b` et `a.b.c` — **lève** en nommant la clé fautive : la
 * tolérer ferait disparaître un texte de l'écran sans que rien ne le dise.
 */
export function unflattenMessages(flat: FlatMessages): NestedMessages {
  const root: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(flat)) {
    const segments = key.split('.')
    let node = root

    for (const [index, segment] of segments.entries()) {
      if (index === segments.length - 1) {
        if (typeof node[segment] === 'object') {
          throw new Error(
            `Collision de clés de traduction : « ${key} » est aussi un préfixe d’autres clés.`,
          )
        }

        node[segment] = value
        continue
      }

      const existing = node[segment]

      if (typeof existing === 'string') {
        throw new Error(
          `Collision de clés de traduction : « ${key} » traverse « ${segments
            .slice(0, index + 1)
            .join('.')} », qui est déjà une traduction.`,
        )
      }

      node[segment] = existing ?? {}
      node = node[segment] as Record<string, unknown>
    }
  }

  return root as NestedMessages
}

/**
 * La forme du routage par locale, **identique dans les deux états**.
 *
 * C'est le point qui décide de trente-six stories : un écran, une entrée de
 * navigation ou un module écrit après s09 appelle `publicPath` et `resolve`
 * sans savoir si l'i18n est activée. Il n'y a donc aucune branche à porter dans
 * le code appelant — seul le point de composition choisit l'implémentation,
 * exactement comme il choisit un mailer.
 *
 * Les deux implémentations vivent à deux endroits différents, et c'est
 * volontaire : celle qui **ne préfixe rien** est ici, parce qu'elle doit exister
 * quand le module `i18n` n'est pas dans le dépôt ; celle qui préfixe est dans le
 * module, parce qu'elle est la fonctionnalité.
 */
export interface LocaleRouting {
  /** Les locales réellement servies. Une seule quand le module est coupé. */
  readonly locales: readonly Locale[]
  readonly defaultLocale: Locale
  /** Vrai quand les URL portent un segment de locale. Lu pour l'affichage, jamais pour brancher une règle. */
  readonly prefixed: boolean
  /** La locale d'une requête entrante. */
  resolve(request: LocaleRequest): Locale
  /** Le chemin **interne** d'une URL publique : le préfixe retiré, s'il y en a un. */
  internalPath(pathname: string): string
  /** L'URL **publique** d'un chemin interne, dans une locale. */
  publicPath(pathname: string, locale: Locale): string
  /**
   * L'URL canonique vers laquelle rediriger, ou `null` s'il n'y a rien à faire.
   *
   * `null` **toujours** quand le module est coupé : « aucune redirection de
   * locale n'a lieu » est un critère, pas une conséquence.
   */
  canonicalPath(request: LocaleRequest): string | null
}

/** Ce qu'une implémentation a le droit de regarder d'une requête entrante. */
export interface LocaleRequest {
  readonly pathname: string
  /** La locale choisie et persistée par l'utilisateur, si elle l'a été. */
  readonly cookieLocale: string | null
  /** L'en-tête `Accept-Language` brut, tel que le navigateur l'envoie. */
  readonly acceptLanguage: string | null
}

/**
 * Le routage d'une application qui ne sert qu'une langue — le module `i18n`
 * coupé.
 *
 * Chaque méthode est l'identité ou la constante correspondante : les URL n'ont
 * pas de préfixe, rien ne redirige, et la locale est celle du site quoi qu'on
 * demande. C'est la définition du critère « module non activé », écrite une
 * fois et exécutable.
 */
export function singleLocaleRouting(defaultLocale: Locale): LocaleRouting {
  return {
    locales: [defaultLocale],
    defaultLocale,
    prefixed: false,
    resolve: () => defaultLocale,
    internalPath: (pathname) => pathname,
    publicPath: (pathname) => pathname,
    canonicalPath: () => null,
  }
}
