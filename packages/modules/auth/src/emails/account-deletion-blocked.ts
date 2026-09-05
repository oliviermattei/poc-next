import type { EmailTemplate } from '@repo/core'

/**
 * **La suppression demandée n'a pas pu aboutir** (s34, critique de la seconde
 * revue).
 *
 * Elle existe parce que le refus arrive **après** la réponse. Le contrôle du
 * dernier propriétaire est rejoué au moment d'effacer — le monde change entre
 * la demande et l'exécution différée —, et une demande acceptée puis refusée en
 * silence est le pire des deux mondes sur un chemin de droit à l'effacement :
 * la personne croit son compte parti, et il ne l'est pas.
 *
 * Le texte ne nomme aucune organisation. Ce n'est pas de la prudence inutile :
 * l'email part vers une boîte, il survit à sa lecture, et le refus **à la
 * demande** nomme déjà les organisations, à l'écran, à la personne connectée.
 * Ici, l'essentiel est qu'elle sache que rien n'a été effacé et quoi faire.
 *
 * **Le texte ne promet pas que rien n'a été effacé**, et c'est le résultat de
 * deux corrections successives. Il l'a promis, et c'était faux : le refus
 * arrivait alors **à l'intérieur** de la purge sur le chemin concurrent, après
 * que les modules purgés plus tôt dans l'ordre inverse — dont `storage`, qui
 * efface chez un tiers de façon irréversible — avaient fait leur travail.
 *
 * Le refus est désormais **antérieur à toute purge** : `runAccountPurge`
 * revendique le départ (`releaseOrganizations`) avant d'appeler `purgeScope`,
 * et n'envoie cet email que sur ce refus-là. Cela vaut **par tentative**, et
 * c'est le résidu qu'il ne faut pas réécrire en absolu (constat m2 de la
 * quatrième revue) : la première tentative peut revendiquer, effacer
 * `demo-enabled`, `storage` et `rate-limit`, puis échouer sur une purge — les
 * sessions ne sont pas révoquées à la demande, donc la personne a pu créer une
 * organisation entre-temps et en être devenue seule propriétaire. La tentative
 * suivante refuse alors, définitivement, et cet email part **alors que des
 * objets ont bel et bien été effacés**.
 *
 * Le texte dit donc ce qui est vrai dans tous les cas — le compte n'a pas été
 * supprimé, et voici quoi faire — et ne dit rien de ce qu'il ne peut pas
 * garantir. La commande qui garde la partie tenable : `pnpm test`, cas « garde
 * un propriétaire quand deux copropriétaires partent ensemble, à chaque
 * course » (`tests/account-deletion.test.ts`), qui vérifie course après course
 * que le compte refusé a gardé ses données.
 */
export const accountDeletionBlockedEmail: EmailTemplate<'fr' | 'en'> = {
  id: 'account-deletion-blocked',
  locales: {
    fr: {
      subject: 'Votre suppression de compte n’a pas pu aboutir',
      body:
        'Votre compte n’a pas été supprimé : vous êtes le dernier propriétaire ' +
        'd’au moins une organisation. Une organisation sans propriétaire ne ' +
        'pourrait plus être administrée par personne.\n\n' +
        'Transférez la propriété à un autre membre, ou supprimez l’organisation, ' +
        'puis demandez à nouveau la suppression de votre compte.',
    },
    en: {
      subject: 'Your account deletion could not complete',
      body:
        'Your account was not deleted: you are the last owner of at least one ' +
        'organisation. An organisation with no owner could no longer be ' +
        'administered by anyone.\n\n' +
        'Transfer ownership to another member, or delete the organisation, then ' +
        'request your account deletion again.',
    },
  },
}
