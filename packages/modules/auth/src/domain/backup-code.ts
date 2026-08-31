/**
 * Les codes de secours du second facteur, **stockés hachés** —
 * `docs/security.md` §2 et le piège nommé par la story s13.
 *
 * ## Pourquoi cette règle existe
 *
 * Better Auth range les codes de secours **chiffrés**
 * (`storeBackupCodes: 'encrypted'`, `symmetricEncrypt` avec le secret de
 * l'application). Chiffré n'est pas haché : qui lit la base et connaît le
 * secret retrouve dix mots de passe à usage unique en clair. La bibliothèque
 * accepte cependant un couple `{encrypt, decrypt}` sur ce chemin, et c'est là
 * que cette règle se branche — `decrypt` est l'identité, `encrypt` est
 * `digestBackupCodes`, et la **saisie** est hachée par la route avec
 * `digestBackupCode` avant d'atteindre la bibliothèque. La comparaison porte
 * alors empreinte contre empreinte, et rien de réversible n'est écrit.
 *
 * ## Deux fonctions, et la séparation **est** la règle de sécurité
 *
 * Ce fichier a porté un seul aiguillage, appliqué aux deux chemins, et c'est
 * ce qui a fait échouer la revue de s13 : la fonction reconnaissait une
 * empreinte et la laissait passer **inchangée**, y compris quand elle venait
 * du monde extérieur. Une chaîne `sha256:<64 hexadécimaux>` lue en base et
 * postée sur `/auth/two-factor/verify-backup-code` traversait donc la route
 * sans être hachée et arrivait telle quelle dans le `codes.includes(code)` de
 * la bibliothèque : **l'empreinte volée valait le code**. Un vol de base sans
 * `AUTH_SECRET` donnait dix contournements — strictement moins sûr que le
 * `encrypted` que ce montage remplace.
 *
 * D'où deux fonctions qui ne se ressemblent plus :
 *
 * | | Ce qu'elle reçoit | Ce qu'elle fait d'une empreinte |
 * |---|---|---|
 * | `digestBackupCode` | **la saisie**, venue du réseau | elle la hache, comme tout le reste |
 * | `digestBackupCodes` | la charge du magasin, rendue par la bibliothèque | elle la laisse telle quelle |
 *
 * Ce qui vient de l'extérieur est **toujours** haché, sans exception ni
 * reconnaissance de forme : une entrée qui se reconnaît elle-même est une
 * porte. `isBackupCodeDigest` ne sert donc plus qu'au magasin, où le
 * ré-encodage est un fait de la bibliothèque et non une valeur choisie par un
 * appelant.
 *
 * ## Le piège du ré-encodage, côté magasin
 *
 * `verifyBackupCode` filtre le code consommé puis rappelle l'encodeur avec le
 * **reste du tableau**, qui contient déjà des empreintes. Hacher deux fois
 * rendrait les neuf codes restants inutilisables — une panne silencieuse,
 * visible seulement au deuxième usage. D'où l'aiguillage, et d'où le
 * discriminant : un code émis par la bibliothèque a la forme `XXXXX-XXXXX`
 * (dix caractères de `a-z0-9A-Z`, un tiret au milieu), une empreinte a la
 * forme `sha256:` suivi de soixante-quatre hexadécimaux. Aucun code émis ne
 * peut porter ce préfixe.
 *
 * ## Ce que ce fichier ne contient pas
 *
 * La primitive. Le `domain` ne connaît aucune bibliothèque tierce hors Zod
 * (`packages/modules/auth/AGENTS.md`), et `node:crypto` appartient à
 * `infrastructure/`. La fonction de hachage est donc **reçue** : ici vit
 * l'aiguillage, là-bas le HMAC poivré.
 */

/** Le préfixe d'une empreinte. Il n'appartient à aucun code émis. */
export const BACKUP_CODE_DIGEST_PREFIX = 'sha256:'

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/

/**
 * Cette valeur est-elle déjà une empreinte produite ici ?
 *
 * **Réservé au magasin.** Personne ne doit poser cette question d'une valeur
 * reçue d'un appelant : y répondre « oui » revient à accepter l'empreinte
 * comme un code.
 */
export function isBackupCodeDigest(value: string): boolean {
  return DIGEST_PATTERN.test(value)
}

/** Ce qui hache un code de secours : reçu, jamais choisi ici. */
export type BackupCodeHash = (value: string) => string

/**
 * L'empreinte d'**un** code saisi — celle que la route calcule avant de
 * transmettre la saisie à la bibliothèque.
 *
 * **Inconditionnelle.** Elle ne regarde pas la forme de ce qu'elle reçoit :
 * une empreinte soumise comme code est hachée à son tour, donc ne correspond à
 * rien en base. C'est cette absence de condition qui rend vraie la phrase
 * « la base ne contient rien de rejouable ».
 */
export function digestBackupCode(value: string, hash: BackupCodeHash): string {
  return `${BACKUP_CODE_DIGEST_PREFIX}${hash(value)}`
}

/**
 * La charge stockée, à partir de celle que la bibliothèque remet.
 *
 * Entrée et sortie sont toutes deux le JSON d'un tableau de chaînes : c'est le
 * contrat de `storeBackupCodes.encrypt`. Une charge d'une autre forme est
 * **refusée** plutôt que recopiée — la recopier écrirait des codes en clair,
 * c'est-à-dire exactement ce que cette fonction existe pour empêcher.
 *
 * C'est **ici**, et ici seulement, qu'une empreinte reste une empreinte : la
 * bibliothèque rappelle l'encodeur avec ce qu'elle vient de lire.
 */
export function digestBackupCodes(payload: string, hash: BackupCodeHash): string {
  let parsed: unknown

  try {
    parsed = JSON.parse(payload)
  } catch {
    throw new Error('Codes de secours : charge illisible, rien n’est stocké.')
  }

  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== 'string')) {
    throw new Error('Codes de secours : charge inattendue, rien n’est stocké.')
  }

  return JSON.stringify(
    (parsed as readonly string[]).map((entry) =>
      isBackupCodeDigest(entry) ? entry : digestBackupCode(entry, hash),
    ),
  )
}
