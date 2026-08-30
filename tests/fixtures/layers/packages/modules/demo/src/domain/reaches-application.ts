// VIOLATION : domain → application.
import { placeOrder } from '../application/place-order'

export const label = placeOrder({ id: 'x', total: 0 })
