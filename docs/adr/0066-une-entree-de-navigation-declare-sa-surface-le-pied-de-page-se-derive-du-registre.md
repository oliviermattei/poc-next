# ADR 066 — Une entrée de navigation déclare sa surface, et le pied de page public se dérive du registre

- Status: accepted
- Date: 2026-09-06
- Scope: story s31-changelog

## Context

Le pied de page du site public porte des liens de **service** — la page cookies
depuis s36, les nouveautés depuis s31. Jusqu'ici, ils étaient construits par le
socle et **importés nommément** par les écrans : `consentFooterLinks`
(`apps/web/lib/consent.ts`) apparaissait dans **sept** fichiers de
`apps/web/app` (mesuré sur `dev` : `page.tsx`, `contact/`, `legal/[document]/`,
`blog/`, `blog/[slug]/`, `docs/`, `docs/[section]/[page]/`), trois par
`footerLinks`, quatre par `extraLinks`.

s31 demande que le lien des nouveautés **disparaisse avec le module** (critère
5). Ajouté par le même chemin, il aurait été un **second nom aux sept mêmes
endroits**, puis un troisième au module suivant : le coût d'un module de plus
est linéaire en écrans, et chacun de ces écrans doit alors connaître un module
optionnel — exactement ce que `apps/web/AGENTS.md` interdit à un écran.

Le contrat de module portait déjà une clé `navigation`, mais elle alimentait la
**barre latérale de l'application** et rien d'autre. Le module `consent`
déclarait donc `navigation: []` tout en ayant un lien de navigation, ce qui
était le symptôme : la clé existait, la surface manquait. C'est un changement du
contrat de `packages/core`, et le précédent du dépôt pour un changement de
contrat est un ADR (054 pour `publicUrls`, 024 pour le second point d'entrée) —
c'est ce qui manquait à la revue de s31.

## Decision

`NavigationEntry` gagne un champ **facultatif** `surface: 'app' | 'footer'`, et
`visibleNavigation(registry, session, surface = 'app')` filtre dessus.
`apps/web/lib/footer.ts` dérive les liens du pied de page public du registre —
un seul appelant, `publicFooterLinks(t)`, dans tous les écrans — et
`consentFooterLinks` disparaît. Le module `consent` déclare son entrée
`surface: 'footer'` ; le module `changelog` fait de même dès sa première ligne.

**Facultatif, et l'asymétrie avec `protection` est délibérée** : la valeur par
défaut (`'app'`) est celle qu'avaient **toutes** les entrées écrites avant cette
clé, si bien qu'aucun module existant n'a eu à être rouvert pour y écrire la même
valeur. `protection`, elle, n'a pas de défaut sûr : un défaut « public » ouvrirait
une entrée par omission. `navigationSurfaceOf(entry)` applique ce défaut **une
seule fois**, dans `@repo/core`, plutôt que `entry.surface ?? 'app'` chez chaque
appelant.

Les deux surfaces sont **disjointes** : une entrée déclarée pour l'une
n'apparaît jamais dans l'autre. Un lien de service au rang des fonctionnalités
du produit serait une régression d'écran, et c'est précisément ce que `consent`
évitait en ne déclarant rien.

Ce n'est **pas** une décision d'indexation : `publicUrls` reste la seule source
du plan de site (ADR 054). `public` est un niveau de protection — qui peut
entrer —, pas un mérite d'index.

## Considered options

- **Un quatrième import nommé (`changelogFooterLinks`)** — rejeté : honnête et
  immédiat, mais il ne passe pas l'échelle. Il ajoutait un second nom dans les
  sept fichiers déjà concernés, et le module suivant en aurait ajouté un
  troisième. Le coût d'un module optionnel doit être **nul** pour les écrans ;
  c'est la promesse que `pnpm test:minimal-profile` mesure. La recherche de s31
  l'a nommé « honnête mais qui ne passe pas l'échelle ».
- **Une seizième clé du contrat (`footerLinks`)** — rejeté : une clé par surface
  est un mauvais chemin. Elle aurait dupliqué `protection`, `order` et `labelKey`
  pour redire ce que `navigation` dit déjà, et surtout : chaque clé ajoutée au
  contrat rouvre **tous** les modules déjà écrits, puisque toute clé y est
  obligatoire. Une nouvelle surface (barre supérieure, menu de compte) aurait
  alors demandé une dix-septième clé, et la même mécanique une troisième fois.
- **Réutiliser `navigation` en distinguant la surface** — **retenu**. C'est la
  seule voie qui ne coûte ni une clé par endroit, ni un nom par écran : un module
  qui veut un lien le déclare là où il déclare déjà ses autres entrées, et le
  registre — qui n'agrège que les modules activés — le fait apparaître et
  disparaître sans condition écrite nulle part.
- **Dériver le pied de page des entrées de navigation `public`** — rejeté :
  c'eût été gratuit, et faux. `public` est un niveau de protection ; la
  configuration livrée porte des entrées publiques qu'aucun pied de page ne doit
  montrer (`/sign-in`, `/pricing`, une route d'API). C'est le même raisonnement
  qu'ADR 054 tient pour le plan de site, et la même conclusion.
- **Déclarer le lien dans `config/marketing.ts`** — rejeté : il disparaîtrait
  avec le **site public** au lieu de disparaître avec **son** module, ce qui est
  exactement la non-conformité relevée en s36 (finding F57) pour le lien du
  consentement.

## Consequences

**Ce qui devient plus facile.** Un module qui veut un lien de pied de page
déclare une entrée et n'ouvre aucun écran. `tests/changelog.test.ts` le mesure
avec un module de test qui n'existe que là : son lien paraît, et disparaît quand
il est coupé. Le balayage de `apps/web/app` refuse par ailleurs une seconde
expression de lien de pied de page, ou un identifiant de module dans celle qui
reste.

**Ce qui devient plus difficile.** Le contrat porte un champ de plus, et un
champ facultatif est un champ qu'on peut oublier : un module qui veut un lien de
pied de page et n'écrit pas `surface` obtient une entrée de barre latérale, ce
qui est visible à l'écran mais que rien ne refuse. La contrepartie est celle
qu'on a choisie : ne pas rouvrir les modules existants.

**Ce qu'il faut surveiller.** Une **troisième** surface. `NavigationSurface` est
une union fermée de deux valeurs ; en ajouter une troisième est une ligne, mais
c'est aussi le moment où il faudra se demander si la surface est encore une
propriété de l'entrée ou une propriété de l'écran qui la rend. Tant qu'il y en a
deux, elle appartient à l'entrée. Et la règle du défaut vaut ce que vaut son
unique application : si `navigationSurfaceOf` cesse d'être le seul endroit qui
écrit `?? 'app'`, la règle est recopiée, donc perdue.
