// Arête AUTORISÉE : c'est dans `application` que vivent les ports (ADR 006).
import type { Mailer } from '@repo/ports'

export interface PlaceOrderDependencies {
  readonly mailer: Mailer
}
