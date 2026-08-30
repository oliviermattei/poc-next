// AUTORISÉ : zod n'est ni un framework, ni un ORM, ni un SDK.
import { z } from 'zod'

export const orderId = z.string().min(1)
