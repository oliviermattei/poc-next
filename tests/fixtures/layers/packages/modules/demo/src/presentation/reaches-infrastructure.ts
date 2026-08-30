// VIOLATION : presentation → infrastructure.
import { save } from '../infrastructure/order-repository'

export const label = save({ id: 'x', total: 0 })
