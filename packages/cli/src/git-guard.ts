import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

/**
 * La garde « dépôt propre » (s41, ADR 041).
 *
 * `ks toggle` (s05) ne la pose pas : un humain qui tape la commande a déjà la
 * garde qu'il lui faut — il voit ce qu'il fait, et `git diff` lui rend la main
 * à tout moment. Un agent piloté par MCP n'a pas cette garde-là : rien ne
 * l'empêche d'enchaîner des opérations sans jamais relire. La précondition est
 * donc posée aux points de composition qui écrivent **pour le compte d'un
 * agent** — les deux outils MCP qui modifient le dépôt, et `ks scaffold`, qui
 * n'existait pas avant cette story — jamais réinjectée dans `ks toggle`.
 *
 * `git status --porcelain` est interrogé, jamais réimplémenté : un dépôt sale
 * est un fait du dépôt, pas une opinion de ce fichier.
 */
export class DirtyRepositoryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DirtyRepositoryError'
  }
}

const execFileAsync = promisify(execFile)

/**
 * Refuse si le dépôt à `cwd` a des modifications non commitées (suivies ou
 * non), pour que le développeur puisse toujours annuler ce qu'un agent vient
 * de faire.
 *
 * Ne modifie jamais le dépôt : c'est une lecture seule, appelée **avant**
 * toute écriture par l'appelant.
 */
export async function assertRepositoryClean(cwd: string): Promise<void> {
  const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd })
  const files = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  if (files.length > 0) {
    throw new DirtyRepositoryError(
      `Le dépôt a des modifications non commitées, l’opération est refusée pour que vous puissiez ` +
        `toujours annuler : ${files.map((line) => `« ${line} »`).join(', ')}. Commitez ou remisez-les, ` +
        'puis relancez.',
    )
  }
}
