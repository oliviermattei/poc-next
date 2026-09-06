/**
 * **Le filtrage des données sensibles, au dernier point avant le réseau.**
 *
 * `docs/security.md` §5 : un secret n'atteint jamais un journal, une réponse
 * d'erreur **ou la télémétrie**. C'est cette dernière moitié que le critère 2 de
 * s39 demande de prouver, et la preuve porte sur la **requête capturée**.
 *
 * **Pourquoi ici, et pas plus haut.** Une règle posée au point de composition ou
 * dans le domaine d'un module est contournable par quiconque tient l'adaptateur
 * — c'est-à-dire par le prochain agent qui « fait marcher » une mesure. Le
 * dernier point avant le réseau est le seul qu'aucun appelant ne peut éviter.
 *
 * **Pourquoi elle est écrite deux fois dans le dépôt** (ici et dans
 * `@repo/adapter-posthog`) : un adaptateur ne dépend d'aucun package du dépôt
 * hormis `@repo/ports`, qui ne porte que des types — c'est la même frontière, et
 * le même arbitrage, que le classement transitoire/définitif d'Inngest, écrit
 * « une fois par côté de la frontière ». Les deux charges utiles n'ont d'ailleurs
 * pas la même forme : un contexte et une trace ici, des propriétés scalaires
 * là-bas.
 *
 * Ce que cette règle **ne** fait **pas** : deviner qu'une valeur anodine est
 * personnelle. Elle refuse ce qu'elle reconnaît — des noms de champs et des
 * formes de secrets —, elle ne remplace pas le jugement de l'appelant sur ce
 * qu'il mesure.
 */

/**
 * Les fragments de **nom de champ** qui font retirer la valeur entière.
 *
 * Comparés sur le nom normalisé (minuscules, sans séparateur), si bien que
 * `resetToken`, `reset_token` et `RESET-TOKEN` tombent sur le même fragment.
 * Volontairement sans `auth` seul ni `key` seul : ils emporteraient `author` et
 * `keyword`, et un filtre qui mange les données anodines finit désarmé.
 */
export const SENSITIVE_FIELD_FRAGMENTS = [
  'password',
  'passwd',
  'pwd',
  'secret',
  'token',
  'apikey',
  'authorization',
  'credential',
  'cookie',
  'session',
  'privatekey',
  'accesskey',
  'creditcard',
  'cardnumber',
  'cvv',
  'ssn',
  'otp',
  'bearer',
] as const

/**
 * Les **formes** de secret reconnues dans une valeur, quel qu'en soit le nom de
 * champ. C'est la seconde ligne : un jeton passé sous un nom anodin ne doit pas
 * partir non plus.
 */
const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g,
  /\b(?:sk|pk|rk|whsec|phc)_[A-Za-z0-9_-]{6,}/g,
  /\bBearer\s+[A-Za-z0-9._-]{8,}/gi,
  /\b[A-Za-z0-9_-]*(?:session|token|secret)[A-Za-z0-9_-]*=[^\s;,"']+/gi,
]

/** La marque laissée à la place. Une valeur retirée se voit ; une valeur absente se devine. */
export const REDACTED = '[filtré]'

const normalize = (name: string): string => name.toLowerCase().replaceAll(/[^a-z0-9]/g, '')

/** Le nom de ce champ le rend-il sensible ? */
export const isSensitiveFieldName = (name: string): boolean => {
  const normalized = normalize(name)

  return SENSITIVE_FIELD_FRAGMENTS.some((fragment) => normalized.includes(fragment))
}

/** Masque ce qui **ressemble** à un secret dans un texte libre. */
export const redactSecretsInText = (value: string): string =>
  SECRET_VALUE_PATTERNS.reduce((text, pattern) => text.replaceAll(pattern, REDACTED), value)

export interface RedactionOutcome<TValue> {
  readonly values: Readonly<Record<string, TValue>>
  /** Les **noms** des champs retirés — jamais leurs valeurs (`MonitoringLogRecord`). */
  readonly redacted: readonly string[]
}

/**
 * Retire les champs sensibles d'un enregistrement, et masque les formes de
 * secret dans ce qui reste.
 */
export function redactRecord<TValue extends string | number | boolean>(
  values: Readonly<Record<string, TValue>>,
): RedactionOutcome<TValue | string> {
  const kept: Record<string, TValue | string> = {}
  const redacted: string[] = []

  for (const [name, value] of Object.entries(values)) {
    if (isSensitiveFieldName(name)) {
      redacted.push(name)
      continue
    }

    if (typeof value === 'string') {
      const masked = redactSecretsInText(value)

      if (masked !== value) {
        redacted.push(name)
      }

      kept[name] = masked
      continue
    }

    kept[name] = value
  }

  return { values: kept, redacted }
}
