/**
 * Les initiales d'un nom, pour le repli d'un `Avatar`.
 *
 * Elle vit dans le design system parce que le repli **est** un comportement du
 * composant `Avatar` (`docs/design-system.md` : « Utilisateur ou organisation,
 * repli sur les initiales ») : la calculer chez chaque appelant en ferait deux
 * versions, qui divergeraient sur le nom composé et sur le nom vide.
 *
 * Deux caractères au maximum, en majuscules. Un nom vide ou fait de séparateurs
 * rend une chaîne vide plutôt qu'un point d'interrogation : un cercle vide est
 * un repli honnête, un `?` est une opinion écrite en dur qu'aucun catalogue ne
 * traduit.
 *
 * `Intl.Segmenter` n'est pas employé ici, et c'est un choix borné : les
 * initiales sont prises sur les **points de code**, ce qui suffit aux alphabets
 * latins, grecs et cyrilliques, et donne un résultat approximatif sur les
 * écritures à grappes (un émoji composé, un nom en devanagari). Aucun de ces cas
 * n'a été mesuré ici ; le jour où l'un compte, c'est `Intl.Segmenter` qu'il
 * faudra employer, pas une seconde condition.
 */
export function initialsOf(name: string): string {
  const words = name
    .trim()
    .split(/[\s_-]+/u)
    .filter((word) => word !== '')

  if (words.length === 0) {
    return ''
  }

  // Un seul mot : ses deux premiers caractères. Deux mots ou plus : le premier
  // caractère du premier et celui du dernier — « Marie-Claire Le Guen » donne
  // « MG », pas « MC ».
  const characters =
    words.length === 1
      ? [...(words[0] ?? '')].slice(0, 2)
      : [[...(words[0] ?? '')][0] ?? '', [...(words.at(-1) ?? '')][0] ?? '']

  return characters.join('').toLocaleUpperCase()
}
