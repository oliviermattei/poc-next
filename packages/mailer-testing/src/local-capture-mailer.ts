import { mkdir, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

import type { EmailRenderer, Mailer, SendEmailInput, SendEmailResult } from '@repo/ports'

/**
 * La capture locale : **un outil de développement**, pas un fournisseur.
 *
 * `docs/reliability.md` §2 : « Aucun port ne dépend d'une clé d'API pour
 * fonctionner en développement local : capture locale des emails, stockage sur
 * disque… ». Sans clé Resend, l'email est rendu puis écrit dans un dossier
 * ignoré par git, où il s'ouvre dans un navigateur.
 *
 * Ce n'est pas un second adapter (ADR 008) : SMTP, SendGrid et Nodemailer
 * restent au cimetière. Rien ici ne parle à un service tiers.
 */
export interface LocalCaptureMailerOptions {
  /** Dossier d'écriture, **injecté** : ce module ne devine ni le `cwd`, ni la racine du dépôt. */
  readonly directory: string
  readonly render: EmailRenderer
}

/**
 * Nom de fichier sûr, dérivé du template.
 *
 * Le template vient de l'appelant : sans assainissement, `../../etc/passwd`
 * ferait écrire l'outil de développement hors de son dossier. Tout ce qui n'est
 * ni lettre ni chiffre devient un tiret — un point suffirait à reconstruire
 * `..`.
 */
const safeSegment = (value: string): string =>
  value.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'email'

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

export function createLocalCaptureMailer(options: LocalCaptureMailerOptions): Mailer {
  let counter = 0

  return {
    async send(input: SendEmailInput): Promise<SendEmailResult> {
      counter += 1
      const id = `local-${Date.now()}-${counter}`

      let rendered
      try {
        rendered = await options.render(input)
      } catch {
        // Un template inconnu ou une donnée manquante est un défaut de
        // programmation, pas une panne : définitif, jamais rejoué.
        return {
          ok: false,
          error: {
            code: 'invalid_request',
            message: `Rendu du template « ${input.template} » impossible.`,
            attempts: 1,
          },
        }
      }

      // `basename` est la ceinture par-dessus les bretelles de `safeSegment` :
      // il n'est atteignable que si l'assainissement régresse — `safeSegment`
      // s'exécute d'abord et ne laisse ni `/` ni `.`. Aucun test ne le fait
      // donc rougir, et c'est normal : il n'est pas une garde active, il est un
      // filet pour une régression de la garde active.
      const file = basename(`${id}-${safeSegment(input.template)}.html`)

      // L'en-tête est visible dans le navigateur, avant le corps de l'email
      // tel qu'il partira. Deux documents concaténés ne sont pas du HTML
      // valide ; c'est assumé pour un outil de développement, où voir d'un coup
      // d'œil le destinataire et le sujet vaut mieux que la validité.
      const banner = [
        '<!doctype html><meta charset="utf-8">',
        '<section style="font:14px/1.6 system-ui;padding:12px;background:#f4f4f5;border-bottom:1px solid #d4d4d8">',
        `<strong>Capture locale — aucun email n'a été envoyé.</strong><br>`,
        `À : ${escapeHtml(input.to)}<br>`,
        `Sujet : ${escapeHtml(rendered.subject)}<br>`,
        `Template : ${escapeHtml(input.template)} (${escapeHtml(input.locale)})`,
        '</section>',
      ].join('')

      try {
        await mkdir(options.directory, { recursive: true })
        await writeFile(join(options.directory, file), `${banner}\n${rendered.html}`, 'utf8')
      } catch {
        // Le disque est le « fournisseur » de cet outil : son indisponibilité
        // dégrade, elle ne lève pas. Le message ne porte ni chemin absolu, ni
        // destinataire.
        return {
          ok: false,
          error: {
            code: 'provider_unavailable',
            message: "Capture locale impossible : l'écriture du fichier a échoué.",
            attempts: 1,
          },
        }
      }

      return { ok: true, id }
    },
  }
}
