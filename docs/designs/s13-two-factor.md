# Design — s13-two-factor

> Dérivé de `docs/design-system.md`. Aucun composant ni token inventé.
> Maquette de référence : `docs/designs/s13-two-factor.html` — c'est une
> **référence**, pas du code : l'implémentation compose avec `packages/ui`.

## Les deux écrans

### 1. `/account` — une carte de plus

Le second facteur n'a pas d'écran à lui : il rejoint les cinq cartes de
`app/account/page.tsx`, en sixième position, après « Sessions ». C'est l'unité
de base des pages de paramètres (`docs/design-system.md`, § Composants), et
c'est là que vivent déjà les deux autres preuves par mot de passe.

```
Card « Double authentification »
├─ CardHeader
│   ├─ CardTitle
│   └─ CardDescription  +  Badge  (success « Activée » | secondary « Désactivée »)
└─ CardContent — trois états, jamais deux à la fois
    │
    ├─ [désactivée, au repos]
    │     form method="post" → Label/Input password → Button « Activer »
    │
    ├─ [désactivée, enrôlement en cours]  ← état client, après la réponse d'« Activer »
    │     ├─ QR code (<svg>, rendu sur place)
    │     ├─ secret en clair, typographie mono, pour la saisie manuelle
    │     ├─ form method="post" → Label/Input code (6 chiffres) → Button « Confirmer »
    │     └─ Alert destructive si le code est refusé
    │
    ├─ [codes de secours, affichés une seule fois]  ← après confirmation ou régénération
    │     ├─ Alert warning « notez-les, ils ne seront plus affichés »
    │     ├─ liste des dix codes, typographie mono
    │     └─ Button « J'ai noté ces codes »  → recharge l'écran depuis le serveur
    │
    └─ [activée]
          ├─ form method="post" → Input password → Button outline « Régénérer les codes »
          └─ form method="post" → Input password → Button destructive « Désactiver »
```

**Ce que l'écran ne fait pas.** Il n'affiche jamais les codes de secours d'un
compte existant : rien ne les relit, ni la page, ni une route — le point
d'entrée `viewBackupCodes` de la bibliothèque est `serverOnly` et n'est pas
déclaré, et `get-totp-uri` non plus. Un code perdu se régénère, il ne se
retrouve pas.

### 2. `/two-factor` — l'écran de vérification

Écran **public** (il n'y a pas encore de session), servi dans le shell comme
`/sign-in`, dont il reprend la structure : un titre, un formulaire principal,
un second formulaire sous un `Separator`, un lien de sortie.

```
h1  « Vérification en deux étapes »
p   description
Alert destructive  (si ?error=…, deux classes et pas plus)
form method="post"  → Input code, autoComplete="one-time-code" → Button « Vérifier »
Separator
h2  « Utiliser un code de secours »
form method="post"  → Input code → Button secondary « Valider ce code »
p   lien « Revenir à la connexion »
```

Les deux formulaires plutôt qu'un basculeur : c'est la forme que `/sign-in`
emploie déjà pour le mot de passe et le magic link, et elle fonctionne sans
JavaScript côté rendu.

## Composants employés

| Composant | Rôle ici | Origine |
|---|---|---|
| `Card` + `CardHeader/Title/Description/Content` | la carte de `/account` | `@repo/ui` |
| `Badge` (`success` \| `secondary`) | état du second facteur | `@repo/ui` |
| `Alert` (`destructive`, `warning`, `success`) | refus, avertissement sur les codes, confirmation | `@repo/ui` |
| `Button` (`default`, `outline`, `destructive`) | les cinq actions | `@repo/ui` |
| `Input`, `Label` | mot de passe et code | `@repo/ui` |
| `Separator` | entre les deux formulaires de `/two-factor` | `@repo/ui` |

**Aucun composant nouveau dans `packages/ui`.**

## Design system gap — signalé, non comblé

`docs/design-system.md` ne couvre **rien** pour :

1. **un QR code** — ni composant, ni règle de taille, ni contraste ;
2. **un secret à recopier** — pas de composant « code copiable », et le rôle
   typographique `mono` du document est déclaré « blocs de code de la
   documentation (s30) et du changelog (s31) », pas « valeur à recopier dans une
   application ».

Ce sont deux gaps, **signalés ici et pas comblés** : la story ne crée aucune
primitive dans `packages/ui`. Ce qu'elle fait à la place, et qui reste de la
composition :

- le QR est un `<svg>` rendu **dans l'écran**, pas un composant partagé. Un
  `<rect>` par module sombre, `fill="currentColor"` sur un fond
  `bg-background`, `viewBox` carré, largeur fixée par une classe utilitaire.
  Aucun token nouveau : le contraste vient de `foreground` sur `background`,
  donc il tient dans les deux thèmes ;
- le secret et les codes de secours emploient `font-mono` et `text-sm`, qui
  existent, avec `bg-muted` et `border-border`. Aucune couleur brute.

Le jour où un second écran demande la même chose (s14, passkeys), ces deux gaps
deviennent des composés à nommer dans le document.

## Tokens

Aucun token nouveau. Employés : `bg-background`, `text-foreground`,
`text-muted-foreground`, `bg-muted`, `border-border`, `bg-card`, et les
sémantiques `success` / `warning` / `destructive` par les variantes de `Badge`
et d'`Alert`. Aucune couleur Tailwind brute (`docs/design-system.md`, Do/Don't).

## Formulaires — les deux règles héritées

`docs/design-system.md`, § « Avant l'hydratation », et elles valent pour les
**cinq** formulaires de cette story :

- `method="post"` écrit en toutes lettres — `pnpm lint` le refuse autrement, et
  le champ en jeu est ici un mot de passe ou un code à usage unique : le repli
  `GET` les mettrait dans l'URL ;
- bouton désactivé jusqu'à l'hydratation.

## États

| État | Traitement | Règle |
|---|---|---|
| Chargement | aucun écran de chargement : les deux écrans sont rendus par le serveur | — |
| Vide | sans objet : le second facteur est activé ou non, il n'y a pas de liste vide | — |
| Erreur | `Alert` `destructive` **au-dessus** des champs, message expliquant quoi faire | § Formulaires |
| Succès | changement d'état visible (le badge bascule, la carte change de forme), pas de toast | § Feedback |

**Les codes de secours ne sont pas un « succès ».** Ils sont un `Alert`
`warning` permanent tant que le panneau est ouvert : c'est une information à
agir, pas une confirmation à faire disparaître.

## Refus — deux classes, jamais un code de bibliothèque

L'écran de vérification ne connaît que deux messages, et il les reçoit du
serveur sous forme de **classe**, jamais de code :

| Classe | Quand | Ce que le message dit |
|---|---|---|
| `invalid` | code faux, code déjà utilisé | « Ce code n'est pas valide. » |
| `restart` | défi expiré, trop de tentatives, compte verrouillé | « Recommencez la connexion. » |

Même forme que les deux classes de refus de fournisseur de s12
(`docs/reviews/s12-oauth-signin.md`) : l'écran **relit** la classe, il ne
reclasse pas. Aucun `INVALID_CODE`, `TOTP_NOT_ENABLED` ni
`TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE` n'atteint le navigateur.

## Accessibilité

- l'`Alert` de refus porte `role="alert"`, celui des codes de secours
  `role="status"` — même convention que `AccountForm` ;
- le champ de code porte `autoComplete="one-time-code"` et
  `inputMode="numeric"` : c'est ce qui déclenche le remplissage automatique du
  code sur iOS et le pavé numérique sur mobile ;
- le QR porte un `<title>` dans son `<svg>` et `role="img"`, avec un nom
  accessible venu du catalogue : sans lui, c'est une image muette ;
- le secret en clair est **doublé** du QR, jamais seul : c'est le chemin des
  lecteurs d'écran et des postes sans caméra.

## Responsive

Rien de spécifique : les cartes de `/account` sont déjà en colonne unique, et
les deux formulaires de `/two-factor` suivent la largeur du shell. Le QR est
plafonné (`max-w-[12rem]`) pour ne pas déborder sous 400 px — c'est le seul
point à vérifier au navigateur.

## Textes

Toutes les chaînes passent par les catalogues du module `i18n` de
l'application (`apps/web/messages/{fr,en}.json`), sous `app.account.twoFactor.*`
et `app.twoFactor.*`. Les deux écrans entrent dans
`tests/rendered-text.test.ts` avec leur champ `refuses`.
