# Design — s18-file-storage-avatar

> Dérivé de `docs/design-system.md`. Aucun composant ni token inventé. Le seul
> composant du système qui manquait à `packages/ui` est `Avatar`, **déjà
> inventorié** par le design system (« Utilisateur ou organisation, repli sur
> les initiales ») : il est copié, pas inventé.

## Les deux surfaces touchées

| Surface | Fichier | Ce qui change |
|---|---|---|
| Menu de compte du shell | `apps/web/app/account-menu.tsx` | le déclencheur rend un `Avatar` au lieu de `UserIcon` ; repli sur les initiales |
| Paramètres du compte | `apps/web/app/account/page.tsx` | une `Card` « Photo de profil » de plus, en tête, avant « Profil » |

Aucun écran neuf, aucun segment de premier niveau à réserver.

## Composants employés

`Avatar` (neuf dans `packages/ui`, inventorié par le système), `Card`,
`CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `Button`, `Alert`,
`Label`. Rien d'autre.

### `Avatar` — la forme retenue

Trois éléments, sur le modèle shadcn/Radix : `Avatar` (racine), `AvatarImage`,
`AvatarFallback`. Le repli est **le comportement de Radix**, pas une condition
d'écran : sans `src`, ou si le chargement échoue, `AvatarFallback` est rendu.
C'est ce qui tient le critère 7 — module coupé, l'URL vaut `null`, les initiales
s'affichent, et aucun code ne teste un identifiant de module.

Deux tailles, par la prop `size` : `sm` (`size-8`, le menu de compte) et `lg`
(`size-16`, la carte de paramètres). Aucune autre.

Tokens employés, tous sémantiques : `bg-muted`, `text-muted-foreground`,
`border-border`, `rounded-full` (forme, pas token de rayon — un avatar est un
cercle dans les quatre cibles).

## La carte « Photo de profil »

```
┌─ Card ─────────────────────────────────────────────────────┐
│ Photo de profil                                            │  CardTitle
│ PNG, JPEG ou WebP. 2 Mo au maximum.                        │  CardDescription
├────────────────────────────────────────────────────────────┤
│  ┌────────┐                                                │
│  │  (AV)  │   [ Choisir une image ]  [ Retirer ]           │
│  │  lg    │   <input type="file" accept="image/png,…">     │
│  └────────┘                                                │
│                                                            │
│  Alert destructive — visible seulement après un refus      │
└────────────────────────────────────────────────────────────┘
```

- disposition `flex flex-col gap-4 sm:flex-row sm:items-center` : l'avatar
  passe **au-dessus** des boutons sous 640 px, jamais à côté d'eux comprimés ;
- `min-w-0` sur la colonne des boutons — la cause n°1 de débordement sous
  400 px, comme le rappelle `apps/web/AGENTS.md` ;
- « Retirer » est un `Button variant="outline"`, pas `destructive` : retirer une
  photo n'est pas une suppression de compte, et le système réserve
  `destructive` aux actions irréversibles portant un `ConfirmDialog` ;
- le refus s'affiche dans un `Alert variant="destructive"` **au-dessus des
  contrôles**, comme le prescrit le patron « Formulaires » du système.

## États

| État | Rendu |
|---|---|
| aucun avatar | `AvatarFallback` = initiales dérivées du nom ; « Retirer » absent |
| avatar présent | `AvatarImage src=/api/modules/storage/file?id=…` ; « Retirer » présent |
| envoi en cours | le bouton porte son état `pending` et est désactivé (patron du système) |
| refus | `Alert destructive`, message **traduit par clé de refus** — jamais le message du serveur affiché tel quel |
| module coupé | la carte n'est **pas rendue** ; le menu de compte rend les initiales |
| avant hydratation | le bouton d'envoi est désactivé (`useHydrated()`), règle héritée de s08 |

## Ce que le formulaire déclare

`<form method="post">`, écrit en toutes lettres — la règle de lint du dépôt. Le
formulaire ne poste jamais nativement : son `action` pointe vers la route de
confirmation, et le chemin nominal est le JavaScript. La méthode est écrite
quand même, parce que c'est précisément le repli pré-hydratation qui met les
champs dans l'URL.

## Textes — clés de catalogue, aucune chaîne en dur

Catalogue du **module** (`packages/modules/storage/src/messages/{fr,en}.json`),
préfixé `storage.` par le registre :

| Clé | fr |
|---|---|
| `avatar.title` | Photo de profil |
| `avatar.description` | PNG, JPEG ou WebP. 2 Mo au maximum. |
| `avatar.choose` | Choisir une image |
| `avatar.remove` | Retirer |
| `avatar.alt` | Photo de profil de {name} |
| `avatar.pending` | Envoi en cours… |
| `avatar.error.tooLarge` | Cette image dépasse 2 Mo. |
| `avatar.error.unsupportedType` | Ce format n'est pas accepté : PNG, JPEG ou WebP. |
| `avatar.error.contentMismatch` | Ce fichier n'est pas une image valide. |
| `avatar.error.failed` | L'envoi a échoué. Réessayez. |

Le **nom accessible** du déclencheur du menu de compte ne change pas : il porte
déjà l'adresse du compte (`app.shell.account.menu`). L'avatar y est décoratif —
`AvatarImage` reçoit `alt=""` dans le menu, parce que le nom accessible du
bouton dit déjà de quel compte il s'agit. Dans la carte, l'image porte
`avatar.alt` avec le nom : c'est là qu'elle est l'information.

## Contraste et thème sombre

Aucune couleur brute. `AvatarFallback` = `bg-muted text-muted-foreground`, tous
deux définis dans les deux thèmes par `packages/ui/src/styles.css`. L'anneau de
focus reste `ring-ring`.

## Mesures au navigateur — **sous le build de production**

Sonde Playwright jetable (créée, exécutée, supprimée ; arbre vérifié propre
après), contre `next start` sur le port 3119, `NODE_ENV=production` — donc sous
la politique de sécurité du contenu **stricte** de s45, celle qui n'a ni
`'unsafe-eval'` ni `'unsafe-inline'` de style.

| Mesure | Résultat |
|---|---|
| violations de politique de sécurité du contenu (`securitypolicyviolation`) | **0** |
| erreurs de console | **0** |
| l'image de l'avatar réellement décodée | `naturalWidth: 1`, `complete: true` |
| l'URL servie | `/api/modules/storage/file?id=…&v=…` — **même origine** |
| débordement horizontal à 1280 px | **0 px** |
| débordement horizontal à 390 px | **0 px** |

C'est la mesure que la story demandait explicitement : **`img-src 'self'` ne
bloque rien**, parce que l'avatar est servi par l'application (ADR 032). Une
image venue du domaine d'un seau aurait donné une violation et un
`naturalWidth: 0`, avec un repli sur les initiales que rien d'autre n'aurait
signalé.

Captures relevées, thèmes clair et sombre, 1280 px et 390 px : le repli sur les
initiales avant tout téléversement (aucun bouton « Retirer » rendu), l'avatar
après, la carte empilée sous 640 px avec ses deux boutons côte à côte, et
l'avatar du menu de compte dans l'en-tête du shell.

## Design system gap

**Aucun.** `Avatar` était inventorié et non copié ; cette story le copie. Rien
d'autre n'a manqué.
