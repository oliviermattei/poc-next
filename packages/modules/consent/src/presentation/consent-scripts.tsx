import type { NonEssentialScript } from '../domain/consent-category'

/**
 * Les scripts non essentiels que le consentement **autorise**, et rien d'autre.
 *
 * Le piège que la story nomme : le consentement conditionne le **chargement**,
 * pas seulement l'envoi d'événements. Une balise posée « au cas où », avec un
 * drapeau qui déciderait ensuite d'émettre ou non, a déjà fait partir l'adresse
 * IP du visiteur chez un tiers — donc traité une donnée personnelle avant tout
 * consentement. Ici, une catégorie non accordée ne produit **aucune balise** :
 * `e2e/consent.spec.ts` observe les requêtes réellement émises, pas seulement le
 * DOM.
 *
 * `defer` et non `async` : React 19 hisse un `<script async>` dans le `<head>`
 * et le dédoublonne, ce qui rendrait la position de la balise dépendante d'un
 * détail de la bibliothèque. `defer` la laisse là où elle est écrite, après le
 * contenu, et garantit qu'elle ne bloque pas le rendu.
 *
 * Aucun script **en ligne** : la politique de sécurité du contenu livrée par
 * s45 les refuse sans nonce, et un tiers a de toute façon besoin de son origine
 * déclarée dans `config/security.ts` (`script-src 'self'` la refuse autrement).
 */
export interface ConsentScriptsProps {
  readonly scripts: readonly NonEssentialScript[]
  /**
   * Le nonce de la requête, et il n'est **pas** facultatif par commodité.
   *
   * La politique livrée par s45 porte `'strict-dynamic'` dans `script-src`, et
   * c'est ce que la première écriture de cette story avait manqué : un
   * navigateur qui comprend CSP niveau 3 **ignore alors `'self'` et toute
   * source d'hôte**. Un `<script src>` sans nonce est refusé, y compris depuis
   * notre propre origine — mesuré au navigateur, le script était demandé et
   * n'exécutait rien.
   *
   * Conséquence à connaître avant s39 : déclarer l'origine d'un fournisseur
   * dans `config/security.ts` ne suffira **pas** à charger son script. C'est le
   * nonce qui l'autorise ; la source d'hôte ne sert qu'aux navigateurs qui ne
   * comprennent pas `'strict-dynamic'`.
   */
  readonly nonce: string | null
}

export function ConsentScripts({ scripts, nonce }: ConsentScriptsProps) {
  return (
    <>
      {scripts.map((script) => (
        <script
          key={script.id}
          src={script.src}
          defer
          nonce={nonce ?? undefined}
          data-consent-script={script.id}
        />
      ))}
    </>
  )
}
