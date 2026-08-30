/** Règle métier pure : aucune couche, aucun framework, aucun ORM. */
export interface Order {
  readonly id: string
  readonly total: number
}

export function isFree(order: Order): boolean {
  return order.total === 0
}
