import { uiTranslations } from 'fumadocs-ui/i18n'

import { i18n } from './i18n'

/**
 * Les libellés de l'interface de Fumadocs. Le paquet ne livre que l'anglais :
 * le français est écrit ici, pour les libellés qu'un lecteur voit — une clé
 * absente s'affiche en anglais.
 */
export const translations = i18n
  .translations()
  .extend(uiTranslations())
  .add({
    fr: {
      displayName: 'Français',
      'Search(search trigger)': 'Rechercher',
      'Search(search dialog)': 'Rechercher',
      'Open Search(search trigger)(aria-label)': 'Ouvrir la recherche',
      'Close Search(search dialog)(aria-label)': 'Fermer la recherche',
      'No results found(search dialog)': 'Aucun résultat',
      'On this page(table of contents)': 'Sur cette page',
      'No Headings(table of contents)': 'Aucun titre',
      'Table of Contents(inline table of contents)': 'Sommaire',
      'Next Page(pagination)': 'Page suivante',
      'Previous Page(pagination)': 'Page précédente',
      'Choose a language(language switcher)': 'Choisir une langue',
      'Choose a language(language switcher)(aria-label)': 'Choisir une langue',
      'Last updated on(page footer)': 'Mis à jour le',
      'Page Not Found(404 page)': 'Page introuvable',
      'Back to Home(404 page)': 'Retour à l’accueil',
      'The page you are looking for might have been removed, had its name changed, or is temporarily unavailable.(404 page)':
        'La page que vous cherchez a peut-être été supprimée ou renommée.',
      'Toggle Theme(theme switcher)(aria-label)': 'Changer de thème',
      'Light(theme switcher)(aria-label)': 'Clair',
      'Dark(theme switcher)(aria-label)': 'Sombre',
      'System(theme switcher)(aria-label)': 'Système',
      'Toggle Menu(mobile menu)(aria-label)': 'Ouvrir le menu',
      'Open Sidebar(sidebar)(aria-label)': 'Ouvrir le menu latéral',
      'Close Sidebar(sidebar)(aria-label)': 'Fermer le menu latéral',
      'Close Sidebar(aria-label)': 'Fermer le menu latéral',
      'Collapse Sidebar(sidebar)(aria-label)': 'Replier le menu latéral',
      'Show Sidebar(sidebar)': 'Afficher le menu',
      'Hide Sidebar(sidebar)': 'Masquer le menu',
      'Copy Text(code block)(aria-label)': 'Copier',
      'Copied Text(code block)(aria-label)': 'Copié',
      'Copy Anchor Link(heading anchor)(aria-label)': 'Copier le lien',
      'Copied Anchor Link(heading anchor)(aria-label)': 'Lien copié',
    },
    en: { displayName: 'English' },
  })
