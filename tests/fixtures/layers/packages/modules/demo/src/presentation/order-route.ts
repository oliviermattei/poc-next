// Arêtes AUTORISÉES : presentation → application, presentation → domain.
import { placeOrder } from '../application/place-order'
import type { Order } from '../domain/order'

export function render(order: Order): string {
  return placeOrder(order)
}
