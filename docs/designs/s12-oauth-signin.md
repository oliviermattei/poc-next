# Design — Story s12-oauth-signin

Dérivé de `docs/design-system.md`. **Aucun composant ni jeton inventé** : tout
compose avec `Button`, `Card`, `Alert`, `Badge`, `Separator` de `@repo/ui` et
les tokens sémantiques existants. Maquette de référence :
`docs/designs/s12-oauth-signin.html` (référence visuelle, pas du code à copier).

## Ce que la story ajoute à l'écran

Trois surfaces, aucune page nouvelle sauf le rebond de retour.

### 1. Les boutons de fournisseur — `/sign-in` et `/sign-up`

Placés **au-dessus** du formulaire d'identifiants, séparés de lui par un
`Separator` : c'est l'ordre de lecture des quatre cibles, et il évite qu'un
utilisateur qui a un compte Google saisisse d'abord un mot de passe qu'il n'a
pas.

- un `Button` `variant="outline"`, pleine largeur, un par fournisseur configuré,
  dans l'ordre déclaré ;
- libellé « Continuer avec Google » / « Continuer avec GitHub », par le
  catalogue i18n (`app.auth.oauth.continueWith` + le nom du fournisseur, qui est
  un nom propre non traduit) ;
- chaque bouton est le seul contenu d'un `<form method="post">` qui poste vers
  la route du module. **Pas de JavaScript** : le serveur répond une redirection
  302 vers le fournisseur, donc le bouton fonctionne avant l'hydratation. C'est
  la seule affordance de l'application qui n'a pas besoin de `useHydrated`, et
  c'est parce qu'elle n'envoie aucun secret ;
- aucun bouton n'est rendu si aucun fournisseur n'est configuré : le bloc entier
  et son `Separator` disparaissent, sans condition dans un composant partagé —
  la liste est vide, il n'y a rien à rendre.

**Design system gap signalé, non comblé** : Lucide 1.37 ne livre plus d'icône de
marque (ni `Github`, ni `Google`), et le système interdit de mélanger deux jeux
d'icônes. Les boutons portent donc **le texte seul**. Ajouter des logos de
marque demanderait une entrée « icônes de marque » au design system ; ce n'est
pas une décision de story.

### 2. Le refus, sur `/sign-in`

Un `Alert` `variant="destructive"` avec `role="alert"`, au-dessus du formulaire,
rendu quand l'URL porte le paramètre de refus. **Deux messages, pas plus** :

| Cas | Message |
|---|---|
| l'utilisateur a refusé l'autorisation chez le fournisseur | « Vous avez refusé l'autorisation. Aucun compte n'a été ouvert. » |
| tout le reste (état invalide, adresse non attestée, compte déjà pris par un autre moyen, panne du fournisseur) | « Connexion par ce fournisseur impossible. Connectez-vous avec votre mot de passe ou demandez un lien de connexion. » |

Le second est **volontairement unique** : un message qui dirait « un compte
existe déjà avec cette adresse » énumérerait les comptes depuis une page
publique (`docs/security.md` §7). La règle de l'écran est celle de s07 — un
refus ne varie pas avec l'état du compte.

### 3. Les fournisseurs liés — `/account`

Une `Card` de plus, après « Sessions actives », dans la grille existante :

- titre « Connexions externes », description courte ;
- une ligne par compte lié : nom du fournisseur, `Badge` `variant="secondary"`
  portant le mot de passe (« Mot de passe ») ou le fournisseur, date de liaison
  formatée **par le serveur** dans la locale servie (même règle que la liste des
  sessions, pour la même raison d'hydratation), et un `Button`
  `variant="outline"` « Délier » ;
- le bouton de déliement est **absent** quand il ne reste qu'un seul moyen de
  connexion, et un texte d'aide dit pourquoi (« C'est votre dernier moyen de
  connexion. »). L'absence du bouton n'est pas la règle : la règle est côté
  serveur, l'écran ne fait que ne pas proposer ce qui sera refusé
  (`docs/security.md` §3 — masquer n'est jamais une permission) ;
- état vide : aucun fournisseur lié ⇒ la carte affiche la ligne « Mot de passe »
  seule. Il n'y a donc jamais d'`EmptyState` ici — un compte a toujours au moins
  un moyen de connexion.

### 4. La page de rebond — `/oauth/return`

Écran **technique**, sans navigation propre : un titre `h1` « Connexion en
cours… » et une phrase. Il existe pour une raison mesurée, pas décorative : le
cookie de session est `SameSite=Strict` (`docs/security.md` §1), et il ne repart
pas sur la fin d'une chaîne de navigation inter-sites. Le rebond same-site
(`<meta http-equiv="refresh">`, donc sans JavaScript) provoque une seconde
navigation, initiée par notre propre document, qui elle porte le cookie.

L'écran est public et se rend identiquement avec ou sans session : il ne lit
rien du compte. Sa destination est **revalidée côté serveur** par la même liste
blanche que `/sign-in`.

## États couverts

| État | Rendu |
|---|---|
| aucun fournisseur configuré | rien : ni bloc, ni séparateur, ni carte de connexions externes autre que « Mot de passe » |
| un ou deux fournisseurs configurés | un bouton par fournisseur, ordre déclaré |
| refus d'autorisation | `Alert` destructive, formulaire intact, aucune session |
| dernier moyen de connexion | ligne visible, action absente, aide affichée |
| mobile (< 400 px) | boutons pleine largeur empilés ; la carte des connexions passe en colonne (`flex-col` sous `sm`), aucun débordement horizontal |
| thème sombre | aucune couleur brute : `outline`, `secondary`, `destructive` sont définis dans les deux thèmes |

## Accessibilité

- chaque bouton de fournisseur est un `<button type="submit">` dans son propre
  formulaire : nom accessible = son libellé traduit ;
- le refus est un `role="alert"` (interruption justifiée : c'est un refus) ;
  la carte des connexions n'en porte pas — c'est du contenu persistant ;
- le déliement est une action destructrice **réversible** (on peut relier) : pas
  de `ConfirmDialog`, que le design system réserve à l'irréversible.

## Ce que cette story ne dessine pas

- **lier un fournisseur depuis les paramètres** : les critères demandent de voir
  et de délier, pas de lier. L'écran ne porte donc pas de bouton « Lier » ;
- **l'avatar du fournisseur** : c'est s18 ;
- **la page d'erreur générique de la bibliothèque** : elle n'est jamais atteinte,
  tous les retours en échec passent par la route de normalisation du module.
