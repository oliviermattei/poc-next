// Arête AUTORISÉE : application → domain.
import { isFree, type Order } from '../domain/order'

export function placeOrder(order: Order): string {
  return isFree(order) ? 'offert' : 'à payer'
}
