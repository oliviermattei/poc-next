# ADR 066 — Une entrée de navigation déclare sa surface, et chaque surface se dérive du registre

- Status: accepted
- Date: 2026-09-06

Le pied de page public portait ses liens de service (cookies, nouveautés) par des imports nommés du socle écrits dans chaque écran : un module optionnel de plus coûtait un nom de plus dans chaque écran, et chaque écran devait connaître ce module. `NavigationEntry` porte donc un champ facultatif `surface` (`NavigationSurface`, dans `packages/core/src/module.ts` : `app`, `footer`, `console`, `site`, `settings`), et `visibleNavigation(registry, session, surface)` filtre dessus. Chaque surface est rendue d'après le registre — `apps/web/lib/footer.ts` pour le pied de page, `apps/web/lib/back-office.ts` pour la console —, si bien qu'une entrée paraît et disparaît avec son module sans qu'aucun écran ne nomme de module.

Le défaut `'app'` est appliqué une seule fois, par `navigationSurfaceOf(entry)` : c'était la surface de toutes les entrées écrites avant ce champ, et aucun module n'a eu à être rouvert. L'asymétrie avec `protection` est délibérée : un niveau de protection n'a pas de défaut sûr, il reste déclaré partout, y compris sur une entrée de console. Les surfaces sont disjointes : une entrée n'en sert qu'une.

La surface reste une propriété de l'entrée tant qu'elle répond à « où ce lien a-t-il un sens ? », question que seul le module qui possède le lien peut trancher. La décision se rouvre le jour où un même lien doit paraître sur deux surfaces, ou où un écran veut choisir ses entrées autrement que par leur surface — pas au rang de la valeur suivante. Ce n'est pas une décision d'indexation : `publicUrls` reste la seule source du plan de site (ADR 054).

## Considered options

- **Une clé de contrat par surface (`footerLinks`, `adminNavigation`)** — rejeté : elle redirait `protection`, `order` et `labelKey`, et chaque nouvelle surface demanderait une clé de plus.
- **Un booléen par surface (`backOffice: true`)** — rejeté : les combinaisons (`footer` + `backOffice`) n'ont pas d'écran, là où une union les ferme à la compilation.
- **La surface comme propriété de l'écran** (un écran liste les modules qu'il montre) — rejeté : l'écran nommerait les modules optionnels, le défaut même qu'on supprime.
- **Dériver le pied de page des entrées `public`** — rejeté : `public` est un niveau de protection, et des entrées publiques (`/sign-in`, `/pricing`) n'ont rien à faire au pied de page.
- **Déclarer le lien dans `config/marketing.ts`** — rejeté : il disparaîtrait avec le site public, pas avec son module.

## Consequences

Un module qui oublie `surface` obtient une entrée de barre latérale : visible à l'écran, mais rien ne le refuse. Le balayage de `apps/web/app` refuse une seconde expression de lien de pied de page ou un identifiant de module dans celle qui reste.
