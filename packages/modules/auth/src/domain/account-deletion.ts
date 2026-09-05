import { z } from 'zod'

/**
 * **La suppression de compte, côté règles** (s34).
 *
 * Deux décisions vivent ici, et elles n'ont pas de framework autour :
 *
 * 1. **la saisie de confirmation est validée puis comparée**, et la comparaison
 *    est celle du serveur. Une comparaison faite par l'écran — « le bouton ne
 *    s'active que si le texte correspond » — n'est pas une confirmation : c'est
 *    une décoration que `curl` contourne. `docs/security.md` §3 le dit pour
 *    toutes les permissions, et une suppression définitive est le pire endroit
 *    où l'oublier ;
 * 2. **ce que « correspond » veut dire** : la casse et les espaces de bord ne
 *    comptent pas, le reste compte. Une adresse se recopie souvent avec une
 *    majuscule automatique sur mobile ; exiger l'octet près ferait échouer une
 *    confirmation authentique, ce qui pousse à supprimer la confirmation.
 */

/**
 * L'identifiant de la tâche de purge, **déclarée par ce module**.
 *
 * Le nom est ici, dans le `domain`, parce que deux couches en ont besoin — la
 * déclaration (`module.ts`) et l'émission (`application/`) — et qu'un
 * identifiant écrit deux fois finit par diverger.
 */
export const ACCOUNT_PURGE_JOB = 'purge-account'

/** Le champ de la charge utile de la tâche : une **référence**, jamais une adresse. */
export const ACCOUNT_PURGE_JOB_FIELD = 'userId'

/**
 * **La langue de la demande**, portée par la charge utile (constat F9 de la
 * revue).
 *
 * Elle y a sa place pour la même raison que l'identifiant : un code de langue
 * est une **référence**, il ne nomme personne (`docs/security.md` §5). Sans
 * elle, la confirmation partait dans la langue du site — un email français à
 * qui lit l'application en anglais —, alors que la langue du destinataire était
 * connue au moment de la demande et perdue une ligne plus loin.
 */
export const ACCOUNT_PURGE_JOB_LOCALE = 'locale'

/**
 * Le corps d'une demande de suppression.
 *
 * **Ce que ce schéma tient, et ce qu'aucune commande ne mesure** — la
 * distinction est demandée par `AGENTS.md` (« ne pas affirmer ce que rien ne
 * vérifie »), et elle a été relevée en revue (constat F6) :
 *
 * - **la forme** est tenue et mesurée : un `confirmation` qui n'est pas une
 *   chaîne n'atteint jamais la comparaison, et la route le dit par un motif à
 *   lui (`confirmation_absente`, distinct de `confirmation_differente`). Le cas
 *   est « refuse une confirmation qui n'est pas une chaîne » ;
 * - **les bornes** — `min(1)`, `max(320)` — ne sont **distinguées par aucun
 *   cas**, et il ne faut pas leur prêter une garantie : une chaîne vide et une
 *   chaîne d'un mégaoctet échouent de toute façon à la comparaison, qui ne
 *   coûte qu'une mise en minuscules. Elles sont là parce que
 *   `docs/security.md` §4 borne toute entrée de frontière, pas parce qu'elles
 *   arrêtent quelque chose d'observable. 320 est la longueur maximale d'une
 *   adresse email (64 + 1 + 255).
 */
const ACCOUNT_DELETION = z.object({
  confirmation: z.string().trim().min(1).max(320),
})

export type AccountDeletionInput = z.infer<typeof ACCOUNT_DELETION>

/**
 * Ce que la validation rend. `invalid_request` ne dit pas quel champ manque : la
 * route en fait un 400, et l'appelant n'a rien à apprendre de plus.
 */
export type AccountDeletionParse =
  | { readonly ok: true; readonly input: AccountDeletionInput }
  | { readonly ok: false }

export function parseAccountDeletion(body: unknown): AccountDeletionParse {
  const parsed = ACCOUNT_DELETION.safeParse(body)

  return parsed.success ? { ok: true, input: parsed.data } : { ok: false }
}

/**
 * La saisie confirme-t-elle **cette** adresse ?
 *
 * Comparaison sans casse ni espaces de bord, et rien d'autre : ni sous-chaîne,
 * ni préfixe. C'est la règle que la route appelle, et la seule.
 */
export function confirmsAccount(confirmation: string, email: string): boolean {
  return confirmation.trim().toLocaleLowerCase() === email.trim().toLocaleLowerCase()
}
