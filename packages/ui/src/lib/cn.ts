import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Compose des classes Tailwind en laissant la dernière gagner.
 *
 * `clsx` aplatit les conditions, `tailwind-merge` résout les conflits : sans
 * lui, `cn('p-2', 'p-4')` produit les deux classes et c'est l'ordre de la
 * feuille de style — pas celui de l'appel — qui décide. Un composant dont la
 * classe passée en `props` ne surcharge pas la classe par défaut n'est pas
 * composable.
 */
export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs))
