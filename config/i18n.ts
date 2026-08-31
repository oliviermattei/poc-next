/**
 * Les langues du projet — le fichier que le propriétaire édite.
 *
 * C'est **l'ensemble de locales de l'application**, et il est distinct des
 * locales que chaque module déclare au contrat. La distinction n'est pas
 * cosmétique : la revue de s06 a mesuré que `assertDeclarationsAreComplete`
 * contrôlait les templates d'email contre les locales **du module**, si bien
 * qu'un module ne livrant que `fr` passait alors que l'application sert `fr` et
 * `en`. Le contrôle porte désormais sur cette liste-ci, transmise par les
 * points de composition, exactement comme `requiredModules`.
 *
 * Ce que ce fichier ne fait pas : décider si l'utilisateur peut **choisir** sa
 * langue. C'est le module `i18n` qui apporte le préfixe de locale dans les URL
 * et le sélecteur ; sans lui, l'application sert `defaultLocale` et rien
 * d'autre. Les deux listes restent vraies dans les deux états : un module doit
 * livrer toutes les locales du projet, module `i18n` activé ou non — sinon
 * l'activer plus tard ferait apparaître des écrans à moitié traduits.
 */
export const appLocales = ['fr', 'en'] as const

/** La locale d'une application qui n'a rien d'autre pour décider. */
export const defaultLocale = 'fr' satisfies AppLocale

/** L'union des locales livrées, dérivée de la liste — jamais recopiée. */
export type AppLocale = (typeof appLocales)[number]
