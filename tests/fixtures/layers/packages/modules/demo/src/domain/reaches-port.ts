// VIOLATION : pureté du domain — un port de dépendance externe.
// Le port vit dans `application`, son implémentation dans `infrastructure`
// (ADR 006). Un `domain` qui connaît le mailer connaît le monde extérieur.
import type { Mailer } from '@repo/ports'

export type OrderNotifier = Mailer
