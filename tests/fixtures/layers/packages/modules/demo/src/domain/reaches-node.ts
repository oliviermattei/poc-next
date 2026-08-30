// VIOLATION : pureté du domain — un module natif de Node.
import { readFileSync } from 'node:fs'

export const read = readFileSync
