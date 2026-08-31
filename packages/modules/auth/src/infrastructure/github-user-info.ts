import type { BoundedFetch } from './oauth-outbound'

/**
 * **La lecture du profil GitHub, bornée.**
 *
 * Pourquoi elle est écrite ici plutôt que laissée à la bibliothèque : les deux
 * appels de `social-providers/github.mjs` passent par `betterFetch` **sans
 * option `timeout`**, et il n'existe aucun moyen de la leur ajouter — ni
 * `customFetchImpl`, ni option de transport n'atteint ce chemin. Le seul point
 * de reprise est `options.getUserInfo`, que le fournisseur consulte avant de
 * faire quoi que ce soit (`if (options.getUserInfo) return options.getUserInfo(token)`).
 * Le prendre, c'est reprendre les deux appels — et donc la dérivation d'adresse
 * qui va avec.
 *
 * **La contrepartie est réelle et il faut la connaître : cette fonction
 * reproduit la logique de la bibliothèque installée (1.7.2), y compris la
 * dérivation d'`emailVerified` dont dépend toute l'ADR 023.** Elle est donc
 * recopiée ligne à ligne de `github.mjs`, et elle est éprouvée par les parcours
 * de `tests/auth.test.ts` — création avec adresse attestée, refus d'une adresse
 * non attestée, liaison — qui passent tous par elle depuis s12. Une montée de
 * version de la bibliothèque doit rouvrir ce fichier.
 *
 * Ce qui n'est **pas** repris, et qui reste à la bibliothèque : `mapProfileToUser`
 * (le module n'en déclare aucun) et le profil brut, rendu tel quel dans `data`
 * parce que `accountSubject` le relit pour construire la clé de compte.
 */

interface GithubProfile {
  readonly id: number | string
  readonly login?: string
  readonly name?: string | null
  readonly avatar_url?: string
  email?: string | null
  readonly [key: string]: unknown
}

interface GithubEmail {
  readonly email: string
  readonly primary?: boolean
  readonly verified?: boolean
}

const readJson = async <T>(response: Response | null): Promise<T | null> => {
  if (response === null) {
    return null
  }

  return (await response.json().catch(() => null)) as T | null
}

export function createGithubUserInfo(boundedFetch: BoundedFetch) {
  return async (token: {
    readonly accessToken?: string | undefined
  }): Promise<{ user: Record<string, unknown>; data: GithubProfile } | null> => {
    const profile = await readJson<GithubProfile>(
      await boundedFetch('https://api.github.com/user', {
        headers: {
          'User-Agent': 'better-auth',
          authorization: `Bearer ${token.accessToken ?? ''}`,
        },
      }),
    )

    if (profile === null) {
      return null
    }

    // L'échec de la **seconde** lecture n'est pas fatal, exactement comme dans
    // la bibliothèque : sans liste d'adresses, `emailVerified` retombe sur
    // `false`, donc sur le refus. Fermé par défaut.
    const emails = await readJson<GithubEmail[]>(
      await boundedFetch('https://api.github.com/user/emails', {
        headers: {
          Authorization: `Bearer ${token.accessToken ?? ''}`,
          'User-Agent': 'better-auth',
        },
      }),
    )

    if (!profile.email && emails) {
      profile.email = (emails.find((entry) => entry.primary) ?? emails[0])?.email
    }

    // **La seule ligne qui compte pour l'ADR 023** : l'adresse retenue n'est
    // attestée que si le fournisseur la marque `verified`. Absente de la liste,
    // liste absente, ou champ absent : `false`.
    const emailVerified = emails?.find((entry) => entry.email === profile.email)?.verified ?? false

    return {
      user: {
        name: profile.name || profile.login || '',
        email: profile.email,
        image: profile.avatar_url,
        emailVerified,
      },
      data: profile,
    }
  }
}
