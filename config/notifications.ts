import { defineNotificationType } from '@repo/emails'

/**
 * Les types de notification du projet — **le fichier que le propriétaire
 * édite** (s32).
 *
 * Une ligne dit trois choses : par quels canaux ce type peut être livré, ce que
 * reçoit un compte qui n'a rien réglé, et le texte de son email. Rien de plus :
 * l'écran de préférences, le centre de notifications et la fonction d'émission
 * unique lisent tous **cette liste**, et il n'y a pas de seconde liste à tenir.
 *
 * **Ce fichier est du socle, et c'est délibéré** (ADR 057). Le critère 7 de la
 * story exige qu'un type déclaré retombe sur un envoi email direct quand le
 * module `notifications` est coupé : un catalogue qui vivrait dans le contrat
 * de ce module disparaîtrait avec lui, et les emails avec — sans erreur, donc
 * sans signal.
 *
 * **`defaults` décide aussi module coupé.** Le repli remplace le canal in-app,
 * qui n'existe plus ; il ne rallume pas un canal que la ligne ci-dessous
 * éteint. Un type déclarant `email: false` n'envoie donc rien dans cette
 * configuration — les préférences par compte y sont hors de portée, elles
 * vivent dans le module coupé, et le défaut déclaré est la seule autorité qui
 * subsiste.
 *
 * **Pourquoi le texte est ici et pas dans un module.** `@repo/core` n'agrège
 * les templates que des modules **activés** : un texte déclaré par le module
 * `notifications` ne serait plus rendable une fois le module coupé, c'est-à-dire
 * exactement dans l'état où le repli doit fonctionner. Le catalogue de rendu de
 * l'émission est donc composé de ces templates-ci **plus** ceux du registre, au
 * point de composition (`apps/web/lib/notifications.ts`).
 *
 * **Ce qui est stocké ne porte aucune donnée personnelle** (revue s32, R1).
 * `actors` nomme les clés de la charge utile **stockée** qui portent une
 * référence de compte ; la valeur affichable est résolue à la lecture. C'est le
 * précédent que tout producteur suivant copie : une ligne de notification est
 * adressée à quelqu'un d'autre et survit aux gens qu'elle nomme, alors qu'une
 * purge de compte n'efface que ce qui lui est **adressé**. Ce qui vaut aussi
 * pour un texte libre — un `{summary}` qui recopierait une adresse ou une
 * empreinte d'appareil retomberait dans le même défaut, sans qu'`actors` puisse
 * le rattraper.
 *
 * **Ce que ce fichier ne fait pas : émettre.** Les six templates d'email
 * existants restent des appels directs légitimes, la story le dit nommément.
 *
 * **Un seul type a un producteur** : `organization.member-joined`, émis par le
 * module `organizations` quand une invitation est acceptée (revue s32, F5). Le
 * module reçoit l'émission au point de composition et ne connaît pas ce
 * fichier. `account.security-alert` n'en a aucun. Les stories qui possèdent un
 * événement (s37, s43) appellent l'émission avec le type qui leur correspond.
 */
export const appNotificationTypes = [
  defineNotificationType({
    id: 'account.security-alert',
    channels: ['in_app', 'email'],
    /**
     * **L'email est actif par défaut, et c'est le seul type dans ce cas.** Une
     * alerte de sécurité que le compte ne lit pas dans l'application est
     * précisément celle qu'il faut lui porter ailleurs : une connexion depuis
     * un appareil inconnu se découvre par l'email, pas par une pastille.
     */
    defaults: { in_app: true, email: true },
    /** Aucune référence de compte : ce type ne parle que du compte destinataire. */
    actors: [],
    email: {
      id: 'account.security-alert',
      locales: {
        fr: {
          subject: 'Activité inhabituelle sur votre compte',
          body:
            'Une activité inhabituelle a été détectée sur votre compte : {summary}.\n\n' +
            'Si vous en êtes à l’origine, il n’y a rien à faire. Sinon, changez votre mot de ' +
            'passe et vérifiez vos sessions ouvertes.',
        },
        en: {
          subject: 'Unusual activity on your account',
          body:
            'Unusual activity was detected on your account: {summary}.\n\n' +
            'If this was you, there is nothing to do. Otherwise, change your password and review ' +
            'your open sessions.',
        },
      },
    },
  }),
  defineNotificationType({
    id: 'organization.member-joined',
    channels: ['in_app', 'email'],
    /**
     * **L'email est coupé par défaut.** Le centre de notifications suffit à
     * suivre l'arrivée d'un membre, et le produit que ce dépôt vise vend « ne
     * rien rater sans être submergé d'emails ». Un compte qui veut l'email
     * l'active ; l'inverse ferait de chaque invitation acceptée un email de
     * plus pour toute l'organisation.
     */
    defaults: { in_app: true, email: false },
    /**
     * `member` porte **l'identifiant** du compte arrivé, pas son adresse.
     *
     * La ligne écrite est celle des **autres** membres : la purge du compte
     * arrivé n'efface que ce qui lui est adressé, donc une adresse écrite ici
     * survivrait à son effacement — pendant que le contrat du module promet
     * `retention: 'erase'`. Le nom affiché est résolu à la lecture.
     */
    actors: ['member'],
    email: {
      id: 'organization.member-joined',
      locales: {
        fr: {
          subject: '{member} a rejoint {organization}',
          body: '{member} vient de rejoindre l’organisation {organization}.',
        },
        en: {
          subject: '{member} joined {organization}',
          body: '{member} has just joined the {organization} organization.',
        },
      },
    },
  }),
] as const
