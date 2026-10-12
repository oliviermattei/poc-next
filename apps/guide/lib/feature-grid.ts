/**
 * **La grille de la page d'accueil du Guide, déclarée une seule fois.**
 *
 * Chaque langue la rend depuis cette donnée (`components/feature-grid.tsx`) :
 * un libellé se traduit ici, une carte ne s'ajoute qu'ici. Ce fichier ne
 * contient que de la donnée — ni JSX, ni composant de Fumadocs ; il ne lit que
 * la déclaration des langues (`lib/i18n.ts`) —, parce que `tests/guide.test.ts`
 * le lit pour vérifier que chaque carte mène à une page et que la grille reste
 * honnête.
 *
 * Les trois badges, et ce qu'ils promettent :
 *
 * - `integrated` : implémenté **et** couvert par les tests du dépôt ;
 * - `compatible` : passe par une interface standard, sans test de notre part ;
 * - `soon` : dans le périmètre de `docs/prd.md` mais pas encore livré, et
 *   toujours avec l'issue GitHub qui le suit. Jamais un élément du cimetière.
 */

import type { Lang, Localized } from './i18n'
import { same } from './i18n'

export type Badge = 'integrated' | 'compatible' | 'soon'

type CommonItem = {
  label: Localized
  /** La page qui explique comment l'activer : son slug, sans la langue. */
  page: string
  /** Une précision qui change ce que le badge laisse croire. */
  note?: Localized
}

export type GridItem =
  | (CommonItem & { badge: 'integrated' | 'compatible' })
  | (CommonItem & { badge: 'soon'; issue: number })

export type GridDomain = {
  title: Localized
  items: readonly GridItem[]
}

/** Le dépôt dont les issues suivent ce qui est prévu. */
export const ISSUES_URL = 'https://github.com/oliviermattei/poc-next/issues'

export const BADGES: Record<Badge, { label: Localized; meaning: Localized }> = {
  integrated: {
    label: { fr: 'Intégré', en: 'Built in' },
    meaning: {
      fr: 'implémenté et couvert par les tests',
      en: 'implemented and covered by tests',
    },
  },
  compatible: {
    label: same('Compatible'),
    meaning: {
      fr: 'passe par une interface standard, sans être testé par nous',
      en: 'works through a standard interface, without being tested by us',
    },
  },
  soon: {
    label: { fr: 'Bientôt', en: 'Coming soon' },
    meaning: {
      fr: 'prévu, avec l’issue GitHub qui le suit',
      en: 'planned, with the GitHub issue that tracks it',
    },
  },
}

/** L'adresse d'une carte dans une langue : la page, sous le préfixe de langue. */
export const cardHref = (item: GridItem, lang: Lang): string => `/${lang}/${item.page}/`

const notYetRunForReal: Localized = {
  fr: 'Guide pas encore joué en réel (issue #145)',
  en: 'Guide not yet run for real (issue #145)',
}

export const FEATURE_GRID: readonly GridDomain[] = [
  {
    title: { fr: 'Base de données', en: 'Database' },
    items: [
      {
        label: same('PostgreSQL 16 + Drizzle'),
        badge: 'integrated',
        page: 'services/postgresql',
      },
      { label: same('Neon'), badge: 'compatible', page: 'services/postgresql' },
      { label: same('Supabase'), badge: 'compatible', page: 'services/postgresql' },
      {
        label: same('Amazon RDS'),
        badge: 'compatible',
        page: 'services/postgresql',
      },
      {
        label: { fr: 'Tout PostgreSQL ≥ 16', en: 'Any PostgreSQL ≥ 16' },
        badge: 'compatible',
        page: 'services/postgresql',
      },
    ],
  },
  {
    title: { fr: 'Authentification', en: 'Authentication' },
    items: [
      {
        label: { fr: 'E-mail et mot de passe', en: 'Email and password' },
        badge: 'integrated',
        page: 'fonctionnalites/authentification',
      },
      {
        label: { fr: 'Lien magique', en: 'Magic link' },
        badge: 'integrated',
        page: 'fonctionnalites/authentification',
      },
      {
        label: {
          fr: 'Double authentification (TOTP et codes de secours)',
          en: 'Two-factor authentication (TOTP and backup codes)',
        },
        badge: 'integrated',
        page: 'fonctionnalites/authentification',
      },
      {
        label: same('Passkeys'),
        badge: 'integrated',
        page: 'fonctionnalites/authentification',
      },
      { label: same('Google'), badge: 'integrated', page: 'services/google' },
      { label: same('GitHub'), badge: 'integrated', page: 'services/github' },
      {
        label: { fr: 'Fournisseur de captcha', en: 'Captcha provider' },
        badge: 'soon',
        issue: 151,
        page: 'configurer/securite',
      },
    ],
  },
  {
    title: { fr: 'Organisations', en: 'Organizations' },
    items: [
      {
        label: { fr: 'Plusieurs organisations par compte', en: 'Several organizations per account' },
        badge: 'integrated',
        page: 'fonctionnalites/organisations',
      },
      {
        label: same('Invitations'),
        badge: 'integrated',
        page: 'fonctionnalites/organisations',
      },
      {
        label: { fr: 'Rôles owner, admin et member', en: 'Owner, admin and member roles' },
        badge: 'integrated',
        page: 'fonctionnalites/organisations',
      },
    ],
  },
  {
    title: { fr: 'Paiement', en: 'Payments' },
    items: [
      { label: same('Stripe'), badge: 'integrated', page: 'services/stripe' },
      {
        label: { fr: 'Abonnements', en: 'Subscriptions' },
        badge: 'integrated',
        page: 'fonctionnalites/facturation',
      },
      {
        label: { fr: 'Achat unique', en: 'One-time purchase' },
        badge: 'integrated',
        page: 'fonctionnalites/facturation',
      },
      {
        label: { fr: 'Période d’essai', en: 'Free trial' },
        badge: 'integrated',
        page: 'fonctionnalites/facturation',
      },
      {
        label: { fr: 'Facturation au siège', en: 'Per-seat billing' },
        badge: 'integrated',
        page: 'fonctionnalites/facturation',
      },
      {
        label: { fr: 'Paiement sans compte', en: 'Guest checkout' },
        badge: 'integrated',
        page: 'fonctionnalites/facturation',
      },
      {
        label: { fr: 'Portail client', en: 'Customer portal' },
        badge: 'integrated',
        page: 'fonctionnalites/facturation',
      },
    ],
  },
  {
    title: { fr: 'E-mails', en: 'Emails' },
    items: [
      { label: same('Resend'), badge: 'integrated', page: 'services/resend' },
      {
        label: same('React Email'),
        badge: 'integrated',
        page: 'configurer/e-mails',
      },
    ],
  },
  {
    title: { fr: 'Stockage de fichiers', en: 'File storage' },
    items: [
      {
        label: same('Amazon S3'),
        badge: 'integrated',
        page: 'services/stockage-s3',
      },
      {
        label: same('Cloudflare R2'),
        badge: 'compatible',
        page: 'services/stockage-s3',
      },
      { label: same('MinIO'), badge: 'compatible', page: 'services/stockage-s3' },
      {
        label: same('DigitalOcean Spaces'),
        badge: 'compatible',
        page: 'services/stockage-s3',
      },
    ],
  },
  {
    title: { fr: 'Tâches de fond', en: 'Background jobs' },
    items: [
      { label: same('Inngest'), badge: 'integrated', page: 'services/inngest' },
    ],
  },
  {
    title: same('Analytics'),
    items: [
      {
        label: { fr: 'PostHog, après consentement', en: 'PostHog, after consent' },
        badge: 'integrated',
        page: 'services/posthog',
      },
    ],
  },
  {
    title: { fr: 'Suivi des erreurs', en: 'Error tracking' },
    items: [
      { label: same('Sentry'), badge: 'integrated', page: 'services/sentry' },
      {
        label: { fr: 'Cartes source', en: 'Source maps' },
        badge: 'integrated',
        page: 'services/sentry',
      },
    ],
  },
  {
    title: { fr: 'Contenu', en: 'Content' },
    items: [
      {
        label: { fr: 'Blog MDX et flux RSS', en: 'MDX blog and RSS feed' },
        badge: 'integrated',
        page: 'fonctionnalites/blog',
      },
      {
        label: { fr: 'Documentation produit', en: 'Product documentation' },
        badge: 'integrated',
        page: 'fonctionnalites/documentation-produit',
      },
      {
        label: same('Changelog'),
        badge: 'integrated',
        page: 'fonctionnalites/changelog',
      },
    ],
  },
  {
    title: { fr: 'Site public', en: 'Public site' },
    items: [
      {
        label: { fr: 'Accueil en sections', en: 'Sectioned home page' },
        badge: 'integrated',
        page: 'fonctionnalites/site-public',
      },
      {
        label: { fr: 'Page des tarifs', en: 'Pricing page' },
        badge: 'integrated',
        page: 'configurer/offres-et-prix',
      },
      {
        label: { fr: 'Pages légales', en: 'Legal pages' },
        badge: 'integrated',
        page: 'fonctionnalites/site-public',
      },
      {
        label: same('Contact'),
        badge: 'integrated',
        page: 'fonctionnalites/site-public',
      },
      {
        label: same('Newsletter'),
        badge: 'integrated',
        page: 'fonctionnalites/site-public',
      },
      {
        label: { fr: 'Liste d’attente', en: 'Waitlist' },
        badge: 'integrated',
        page: 'fonctionnalites/site-public',
      },
      {
        label: { fr: 'Roadmap publique', en: 'Public roadmap' },
        badge: 'soon',
        issue: 180,
        page: 'fonctionnalites/site-public',
      },
    ],
  },
  {
    title: same('Application'),
    items: [
      {
        label: { fr: 'Tableau de bord', en: 'Dashboard' },
        badge: 'integrated',
        page: 'demarrer/premier-tour',
      },
      {
        label: { fr: 'Réglages du compte et de l’organisation', en: 'Account and organization settings' },
        badge: 'integrated',
        page: 'demarrer/premier-tour',
      },
      {
        label: same('Notifications'),
        badge: 'integrated',
        page: 'fonctionnalites/notifications',
      },
      {
        label: same('Onboarding'),
        badge: 'integrated',
        page: 'fonctionnalites/onboarding',
      },
      {
        label: { fr: 'Console superadmin', en: 'Superadmin console' },
        badge: 'integrated',
        page: 'fonctionnalites/console',
      },
      {
        label: { fr: 'Widget de retour', en: 'Feedback widget' },
        badge: 'soon',
        issue: 179,
        page: 'fonctionnalites',
      },
    ],
  },
  {
    title: { fr: 'Conformité', en: 'Compliance' },
    items: [
      {
        label: { fr: 'Bannière de cookies', en: 'Cookie banner' },
        badge: 'integrated',
        page: 'fonctionnalites/cookies-et-consentement',
      },
      {
        label: { fr: 'Export des données (RGPD)', en: 'Data export (GDPR)' },
        badge: 'integrated',
        page: 'fonctionnalites/authentification',
      },
      {
        label: { fr: 'Suppression de compte', en: 'Account deletion' },
        badge: 'integrated',
        page: 'fonctionnalites/authentification',
      },
    ],
  },
  {
    title: { fr: 'Langues', en: 'Languages' },
    items: [
      { label: { fr: 'Français', en: 'French' }, badge: 'integrated', page: 'fonctionnalites/langues' },
      { label: { fr: 'Anglais', en: 'English' }, badge: 'integrated', page: 'fonctionnalites/langues' },
    ],
  },
  {
    title: { fr: 'Déploiement', en: 'Deployment' },
    items: [
      {
        label: { fr: 'Image Docker et Compose', en: 'Docker image and Compose' },
        badge: 'integrated',
        page: 'deployer/docker-et-coolify',
      },
      {
        label: same('Coolify'),
        badge: 'compatible',
        page: 'deployer/docker-et-coolify',
        note: notYetRunForReal,
      },
      {
        label: same('Vercel'),
        badge: 'compatible',
        page: 'deployer/vercel',
        note: notYetRunForReal,
      },
    ],
  },
  {
    title: { fr: 'IA', en: 'AI' },
    items: [
      {
        label: { fr: 'Serveur MCP', en: 'MCP server' },
        badge: 'integrated',
        page: 'fonctionnalites/serveur-mcp',
      },
      {
        label: { fr: 'CLI de modules pnpm ks', en: 'pnpm ks module CLI' },
        badge: 'integrated',
        page: 'fonctionnalites',
      },
    ],
  },
]
