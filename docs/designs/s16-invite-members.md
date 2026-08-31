# Design — s16-invite-members

Dérivé de `docs/design-system.md`. **Aucun composant ni token inventé** : tout
vient du baril `@repo/ui` déjà copié (`Card`, `CardHeader`, `CardTitle`,
`CardDescription`, `CardContent`, `Badge`, `Button`, `Input`, `Label`, `Alert`,
`EmptyState`, `PageHeader`, `OrgSwitcher`, `Separator`) et des tokens sémantiques
(`bg-background`, `text-muted-foreground`, `border-border`, `bg-card`). Maquette
de référence : `docs/designs/s16-invite-members.html` — une référence, pas du
code.

**Aucun design system gap sur cette story.** `Table` et `DataTable` sont nommés
par le design system mais ne sont pas copiés dans `packages/ui` ; ils ne sont pas
nécessaires ici — § Responsive du design system demande de toute façon que « les
tableaux passent en liste de cartes » sous `md`, et les deux listes de cet écran
sont des listes de trois à cinq lignes, pas des tableaux triables.

---

## 1. `/organizations` — l'écran existant, complété

L'ordre des blocs suit la question que se pose l'utilisateur : *où suis-je* →
*qui est là* → *qui arrive* → *comment ça s'appelle* → *en créer une autre*.

| # | Bloc | État | Contenu |
|---|---|---|---|
| 1 | `PageHeader` | existant | titre + description |
| 2 | `Alert` `destructive` `role="alert"` | existant | motif de refus rapporté par `?error=` |
| 3 | Carte « Organisation courante » | existant | `OrgSwitcher` + `Badge` du rôle |
| 4 | **Carte « Membres »** | **neuf** | liste des membres, `Badge` de rôle, bouton « Retirer » |
| 5 | **Carte « Invitations »** | **neuf** | formulaire d'invitation + liste des invitations en attente |
| 6 | Carte « Paramètres » | existant | nom + identifiant |
| 7 | Carte « Créer une organisation » | existant | nom + identifiant |

Les blocs 4, 5 et 6 n'apparaissent **que** lorsqu'une organisation est courante —
même condition que la carte « Paramètres » aujourd'hui (`current === null`).

### 1.1 Carte « Membres »

Une `<ul>` sans puces, une ligne par membre :

```
[ Nom ou adresse du membre ]        [Badge rôle]      [ Retirer ]
```

- l'ordre est celui de la lecture périmétrée (adresse croissante) — un ordre
  stable, sinon la liste danse à chaque rendu ;
- **le membre courant est marqué**, et son bouton dit « Quitter » plutôt que
  « Retirer » : c'est la même route, et le mot doit dire ce qui va se passer ;
- le bouton est `Button variant="ghost" size="sm"` dans son propre
  `<form method="post">` avec un champ caché `organizationId` et un champ caché
  `userId`. Un formulaire par ligne : la soumission native **est** le chemin, il
  n'y a pas de composant client ;
- **le dernier propriétaire n'a pas de bouton** : l'action n'existe pas plutôt
  que d'échouer. Le serveur refuse malgré tout — masquer n'est jamais une
  permission (`docs/security.md` §3), et le refus s'affiche dans l'`Alert` du
  bloc 2 si quelqu'un force la soumission.

Séparation entre deux lignes : `border-t border-border` à partir de la seconde,
pas d'ombre (élévation par bordure et fond).

### 1.2 Carte « Invitations »

Deux parties dans la même `CardContent`, séparées par un `Separator`.

**Le formulaire d'invitation**, en tête, parce que c'est l'action principale :

```
Adresse email  [__________________________]   [ Inviter ]
Un lien à usage unique lui sera envoyé. Il expire au bout de 7 jours.
```

`<form method="post">` — `method` écrit en toutes lettres —, un champ caché
`organizationId` (l'organisation **affichée**, jamais le périmètre courant :
ADR 025, « à surveiller »), `Input type="email" required`, `Label` lié par
`htmlFor`, texte d'aide en `text-xs text-muted-foreground`.

**La liste des invitations en attente**, ensuite :

```
marie@example.test    [Badge statut]   [ Renvoyer ]  [ Révoquer ]
```

- `Badge variant="secondary"` pour « En attente », `Badge variant="outline"` pour
  « Expirée ». Le statut est une donnée, pas une couleur décorative ;
- deux `<form method="post">` par ligne, un par action ;
- **liste vide ⇒ `EmptyState`** avec l'icône `MailPlusIcon`, un titre, une
  explication et pour action le focus sur le champ d'adresse (`<a href="#invite-member">`,
  le patron déjà employé par la carte « Créer une organisation »). Un tableau vide
  sans action est un écran cassé (`docs/design-system.md` § États).

### 1.3 Refus

Tous les refus reviennent par `?error=<code>` sur `/organizations` et sont rendus
par l'`Alert` du bloc 2 — le mécanisme de s15, étendu à quatre codes de plus.
Jamais une phrase dans l'URL : un code, traduit par le catalogue du module.

---

## 2. `/invitations/accept` — l'écran d'atterrissage du lien

Écran de l'**application** (`apps/web/app/invitations/accept/page.tsx`) qui rend
un composant du **module**. Pas de shell différent : il vit dans `AppShell`
comme tous les autres.

Un seul `Card`, centré, `max-w-md`. Quatre états, et un seul rendu à la fois :

| État | Ce qui s'affiche |
|---|---|
| lien valide, visiteur **connecté** | nom de l'organisation, phrase d'invitation, `Button` « Rejoindre » dans un `<form method="post">` portant le jeton en champ caché |
| lien valide, visiteur **anonyme** | la même carte, et à la place du bouton : « Connectez-vous ou créez un compte pour rejoindre », deux liens — connexion avec `?next=` vers cet écran, inscription |
| lien inutilisable (expiré, révoqué, déjà accepté, inconnu) | `Alert variant="destructive" role="alert"` avec **le motif**, et un lien de retour vers l'accueil |
| aucun jeton dans l'URL | le même `Alert`, motif « lien invalide » |

**Le jeton ne déclenche rien en `GET`.** L'acceptation est une soumission. Un
aperçu de lien — client de messagerie, antivirus, proxy — suit les `GET` et
consommerait le jeton à usage unique avant l'invité. C'est la même raison qui
fait de la bascule d'organisation une soumission et non un lien.

Le motif de refus est affiché **tel quel** : le porteur du lien détient déjà le
secret, lui dire « expiré » plutôt que « invalide » ne lui apprend rien qu'il ne
puisse déduire, et le critère 3 exige une erreur explicite.

---

## 3. Responsive

Mobile d'abord, comme le reste (`docs/design-system.md` § Responsive) :

- les lignes de membre et d'invitation sont des `flex flex-wrap items-center
  gap-3 min-w-0` : sous 400 px, le badge et les boutons passent à la ligne, le
  texte tronque (`truncate`), **aucun défilement horizontal** ;
- le formulaire d'invitation est `flex flex-col gap-2 sm:flex-row sm:items-end` :
  champ au-dessus du bouton en mobile, côte à côte au-delà ;
- la carte de `/invitations/accept` est `max-w-md` centrée, donc pleine largeur
  sous 448 px.

## 4. Thème sombre

Aucune couleur brute : `bg-card`, `text-card-foreground`, `text-muted-foreground`,
`border-border`, et les variantes de `Badge` et `Button`. Le thème sombre suit
sans une seule déclaration de plus.

## 5. Accessibilité

- chaque `<form>` porte un `aria-label` traduit — il y en a plusieurs par écran,
  et deux formulaires anonymes seraient indiscernables pour une aide technique
  comme pour Playwright (leçon de s15) ;
- les boutons de ligne portent un nom accessible qui **nomme leur cible** :
  « Retirer <adresse> », « Révoquer l'invitation de <adresse> ». Un écran avec
  quatre boutons « Retirer » est inutilisable au clavier seul. Le nom est composé
  par le catalogue avec un paramètre (`{email}`), jamais par concaténation dans
  le `.tsx`. Le **texte visible**, lui, est court : mettre l'adresse dans le
  bouton le rend indéformable et fait déborder l'écran — mesuré, §6 ;
- `Label htmlFor` sur le champ d'adresse ;
- le refus est un `role="alert"`, comme en s15.

## 6. Vérification visuelle — mesurée, pas déclarée

Sonde jetable (`e2e/s16-visual-probe.spec.ts`, créée, exécutée, **supprimée** ;
arbre vérifié propre après). Chromium, `next dev` sur `E2E_PORT=3116`, locale
`fr-FR`. Ce qui est mesuré : `document.documentElement.scrollWidth` contre
`clientWidth` (débordement horizontal), la présence de la classe `dark` sur
`<html>`, et la couleur de fond calculée du `<body>` — un thème « appliqué »
qu'on ne mesure pas est un thème déclaré.

### Ce que la première mesure a trouvé, et qui a été corrigé

**Débordement horizontal réel**, avec une adresse longue
(`un-prenom-tres-long-et-un-nom-encore-plus-long-<uuid>@sous-domaine.example.test`) :

| Cas | `scrollWidth` | `clientWidth` | Débordement |
|---|---|---|---|
| trois invitations, 1280 px | 1329 | 1280 | **oui** |
| trois invitations, 390 px | 1033 | 390 | **oui** |

La cause n'était pas le libellé de la ligne — `truncate` le tenait — mais **les
boutons** : leur nom accessible portait l'adresse complète (« Renvoyer
l'invitation de … »), et un bouton est `whitespace-nowrap`. Correction : le texte
**visible** est court (« Renvoyer »), le **nom accessible** reste complet par
`aria-label`, sur le `<form>` comme sur le `<button>`. Le nom distinct par ligne
est conservé — c'est lui qui rend l'écran utilisable au clavier — et la largeur
ne l'est plus.

### Après correction

| Écran | Largeur | Thème | `scrollWidth` / `clientWidth` | Débordement | `dark` | Fond `<body>` |
|---|---|---|---|---|---|---|
| organisations, zéro invitation | 1280 | clair | 1280 / 1280 | non | non | `lab(100 0 0)` |
| organisations, zéro invitation | 390 | clair | 390 / 390 | non | non | `lab(100 0 0)` |
| organisations, trois invitations | 1280 | clair | 1280 / 1280 | non | non | `lab(100 0 0)` |
| organisations, trois invitations | 390 | clair | 390 / 390 | non | non | `lab(100 0 0)` |
| organisations, deux membres | 1280 | clair | 1280 / 1280 | non | non | `lab(100 0 0)` |
| organisations, deux membres | 390 | clair | 390 / 390 | non | non | `lab(100 0 0)` |
| organisations, deux membres | 1280 | sombre | 1280 / 1280 | non | **oui** | `lab(2.75 0 0)` |
| organisations, deux membres | 390 | sombre | 390 / 390 | non | **oui** | `lab(2.75 0 0)` |
| acceptation | 1280 | clair | 1280 / 1280 | non | non | `lab(100 0 0)` |
| acceptation | 390 | clair | 390 / 390 | non | non | `lab(100 0 0)` |
| acceptation | 390 | sombre | 390 / 390 | non | **oui** | `lab(2.75 0 0)` |

**Le dernier propriétaire n'a pas de bouton** : avec deux membres dont un seul
propriétaire, le compte des boutons « Retirer … » vaut **1**, pas 2.

### La lisibilité à 390 px — ce que la première mesure ne mesurait pas

Les mesures ci-dessus sont exactes, et la revue les a refaites : aucun
débordement horizontal, dans les deux thèmes, à 390 comme à 1280. Elles ne
disaient rien de la **lisibilité**, et c'est ce qui a échappé (constat F5) : avec
`flex-1` seul — donc `flex-basis: 0` —, le libellé absorbait toute la
compression et l'adresse invitée se rendait sur **8,98 px**, soit un caractère
et un point de troncature (« c. », « u. »), à côté d'un bouton « Révoquer ».
Deux invitations devenaient indiscernables, alors que la ligne porte une action
destructive.

La ligne passe donc en `basis-full` sous `sm` (libellé sur sa propre ligne,
affordances à la suivante), et retrouve `flex-1` dès `sm`. Ce qui est mesuré
depuis, dans `e2e/organizations.spec.ts` et à 390 px :

| Mesure | Avant | Après |
|---|---|---|
| largeur rendue du libellé, adresse de 50 caractères | **8,98 px** | ≥ 200 px (assertion) |
| adresse courte tronquée (`scrollWidth > clientWidth`) | oui | **non** |
| débordement horizontal du document | 0 px | 0 px |

Une assertion sur la classe utilitaire (`basis-full`) aurait prouvé qu'on l'a
écrite, jamais qu'on lit l'adresse : la mesure est la largeur rendue par un
moteur.

### Ce qui n'a pas été vérifié

Dit plutôt que sous-entendu :

- **le contraste** — aucune valeur calculée ; seuls le thème appliqué,
  l'absence de débordement et la largeur rendue du libellé sont mesurés ;
- **un lecteur d'écran réel** — les noms accessibles sont distincts et mesurés
  par les parcours (`getByRole('button', { name: 'Retirer <adresse>' })`), leur
  **annonce** ne l'est pas ;
- **le clavier seul** — l'écran n'a aucune surface flottante nouvelle (les deux
  cartes de s16 sont des formulaires et des boutons natifs), mais aucun parcours
  ne le traverse à la tabulation ;
- **un second moteur** — Chromium seul, comme tout le dépôt ;
- **l'écran d'acceptation en 1280 px sombre** — la sonde a mesuré le thème
  sombre de cet écran à 390 px seulement.
