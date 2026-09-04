# Research — Story s49-contraste-des-alertes

> Vérifiée contre `dev` au commit `b4baf4e`, en lecture seule. Worktree **nu**, aucun conteneur. Les contrastes ci-dessous sont **recalculés ici** (OKLCH → sRGB → luminance relative → WCAG), pas repris de la revue de s28.

## Les cinq faits structurants

1. **Les quatre variantes sont sous le seuil AA en mode clair, et `warning` est sous 3 : 1.** Recalculé indépendamment, texte = jeton sur fond = jeton à 10 % au-dessus de la carte :

   | variante | clair | sombre |
   |---|---|---|
   | `destructive` | **3,99 : 1** | 5,46 : 1 |
   | `info` | **3,24 : 1** | 4,41 : 1 |
   | `success` | **3,03 : 1** | 6,12 : 1 |
   | **`warning`** | **1,83 : 1** | 8,63 : 1 |

   Mes chiffres du mode clair reproduisent exactement ceux de la revue de s28. Le mode sombre passe partout — **le défaut est le mode clair seul**.

2. **La cause n'est pas la teinte, c'est le choix du texte.** `packages/ui/src/components/alert.tsx:17-20` écrit le texte avec **la teinte elle-même** (`text-warning`) sur `bg-warning/10`. Or `packages/ui/src/styles.css:58` déclare `--warning-foreground: oklch(0.205 0 0)` — un quasi-noir — qui n'est **pas utilisé par cette variante**. Le système porte déjà un jeton de texte lisible par sémantique ; le composant ne s'en sert pas.
3. **Deux correctifs possibles, et leurs rayons d'action n'ont rien à voir.** Changer les jetons `--warning`, `--success`, `--info`, `--destructive` touche **toute** surface qui les emploie (bordures, badges, icônes) ; changer ce que la variante d'`Alert` utilise pour son **texte** ne touche que l'`Alert`. La story dit « aucun jeton ni composant inventé » — les deux voies respectent la contrainte, mais l'une est locale et l'autre traverse le produit.
4. **25 usages d'`Alert` dans le dépôt, dont 8 en `warning`.** Aucun n'est à réécrire si le correctif vit dans la variante ; tous changent d'apparence si le correctif vit dans les jetons.
5. **`docs/design-system.md:121` décrit `Alert` par son rôle** (« message contextuel persistant, porté par une sémantique ») et **ne consigne aucun contraste**. Le critère d'acceptation qui demande d'y écrire les valeurs mesurées crée donc une section qui n'existe pas encore.

## Target story

Les quatre variantes atteignent **≥ 4,5 : 1** en clair **et** en sombre · une commande calcule les contrastes **depuis les jetons** et rougit si l'un repasse sous le seuil · aucun jeton ni composant inventé, valeurs consignées dans `docs/design-system.md` avec leur contraste mesuré · les écrans qui emploient déjà ces variantes sont rendus dans les deux thèmes et vérifiés, sans changement de leur code.

Dépendance déclarée : `s09-i18n` — fusionnée.

## Points d'ancrage

- `packages/ui/src/components/alert.tsx:13-24` — `alertVariants`, les quatre lignes qui choisissent bordure, fond et texte.
- `packages/ui/src/styles.css:53-60` (clair) et `:87-92` (sombre) — les jetons sémantiques et leurs `*-foreground`.
- `docs/design-system.md:121` — la ligne d'`Alert`, où les valeurs mesurées doivent atterrir.
- Les 25 usages d'`Alert`, dont `apps/web/app/public-form.tsx:155` et `apps/web/app/two-factor/two-factor-form.tsx:136`, qui portent le refus de limitation livré par s28.

## Pièges & contraintes

- **La commande de vérification est le cœur de la story, pas un bonus.** Un correctif sans elle laisse un contraste qu'un futur ajustement de jeton peut casser en silence — exactement ce que `AGENTS.md` refuse (« une règle qu'aucune commande ne vérifie est de la documentation »). Elle doit dériver les valeurs des **jetons livrés**, jamais d'une table recopiée.
- **Le calcul doit être éprouvé, pas cru.** Une conversion OKLCH → sRGB fausse rendrait la commande verte sur des couleurs illisibles. Un cas doit poser une paire de contraste **connue** et vérifier que la commande la classe correctement.
- **Ne pas confondre le seuil.** WCAG AA vaut 4,5 : 1 pour le texte normal et 3 : 1 pour le grand texte ; `Alert` rend du `text-sm`, donc c'est 4,5 : 1 qui s'applique.
- **La vérification navigateur est demandée par le critère 4** et elle ne peut pas être remplacée par le calcul : c'est le rendu réel qui dira si le fond effectif est bien celui qu'on a supposé (la carte, et non la page).
- **s28 vient de déplacer un refus d'authentification vers `warning`.** C'est aujourd'hui la seule explication qu'un utilisateur bloqué reçoit, dans la variante la moins lisible des quatre. Ce n'est pas un argument esthétique.

## Questions ouvertes

- **Corriger la variante ou les jetons ?** C'est la décision de la story, et elle mérite un ADR : rayon d'action local contre traversant, et conséquence sur les bordures et les badges qui emploient les mêmes jetons. Non tranchée par la story elle-même.
- **`--warning-foreground` est-il le bon texte pour un fond à 10 % ?** Il a été conçu pour un fond **plein**. Sur une teinte à 10 % sur blanc, un quasi-noir passe largement le seuil — mais il fait perdre le codage par la couleur, qui est ce que la sémantique achète. À peser.
- **Le fond effectif est-il la carte ou la page ?** J'ai calculé sur `--card`. Les deux valent `oklch(1 0 0)` en clair, donc le chiffre ne bouge pas — mais en sombre `--card` (0,205) et `--background` (0,145) diffèrent, et un `Alert` posé directement sur la page n'a pas le même fond. Non vérifié au rendu.
- **Faut-il tenir le seuil sur la bordure aussi ?** WCAG demande 3 : 1 pour les éléments d'interface non textuels. `border-warning/50` n'a pas été mesuré ici.

## Complexité réelle

Notée **2** dans `docs/stories.md`. **Ma note : 2** — confirmée, à une condition : que la story se limite à `Alert`. Le correctif est petit, la commande de vérification est le vrai travail, et le rendu dans les deux thèmes est mécanique.

Le risque n'est pas la difficulté, c'est l'élargissement : les mêmes jetons servent ailleurs, et « rendre le produit accessible » n'est pas cette story. Si le plan retient la voie des jetons, il doit nommer explicitement ce qu'il ne corrige pas.

Pas de proposition de découpe.
