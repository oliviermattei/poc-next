// Arêtes AUTORISÉES : infrastructure → application, infrastructure → domain.
import { placeOrder } from '../application/place-order'
import type { Order } from '../domain/order'

export function save(order: Order): string {
  return placeOrder(order)
}
