# Design — s14-passkeys

> Dérivé de `docs/design-system.md`. Aucun composant ni token inventé.
> Maquette de référence : `docs/designs/s14-passkeys.html` — c'est une
> **référence**, pas du code : l'implémentation compose avec `packages/ui`.

## Les deux surfaces

Aucun écran nouveau. Une passkey s'enregistre depuis les paramètres et sert à
la connexion : les deux écrans existent déjà, et chacun reçoit **un** bloc.

### 1. `/account` — une carte de plus, la septième

Elle se place **après « Connexions externes »** et avant « Double
authentification » : les deux cartes voisines parlent de moyens de connexion,
et la règle du dernier moyen les lie (recherche §7). L'ordre lu de haut en bas
devient : Profil · Adresse email · Mot de passe · Connexions externes ·
**Passkeys** · Double authentification · Sessions actives.

```
Card « Passkeys »
├─ CardHeader
│   ├─ CardTitle
│   └─ CardDescription
└─ CardContent
    │
    ├─ Alert destructive (role="alert")     ← un refus, une classe et pas un code
    │
    ├─ [aucune passkey]
    │     EmptyState : titre, explication, action « Enregistrer une passkey »
    │
    ├─ [une ou plusieurs]
    │     ul
    │      └─ li  (une par passkey)
    │           ├─ nom + « Ajoutée le … »        (text-sm / text-xs muted)
    │           ├─ Button outline « Renommer »
    │           └─ Button destructive « Révoquer »
    │                  ou, pour le dernier moyen de connexion :
    │                  texte « C'est votre dernier moyen de connexion. »
    │     └─ Button « Enregistrer une passkey »
    │
    └─ [renommage en cours — une seule ligne à la fois]
          form method="post" → Label/Input « Nouveau nom » → Button « Enregistrer ce nom »
                                                            Button ghost « Annuler »
```

**Le bouton d'enregistrement n'est rendu que si le navigateur sait faire.**
`browserSupportsWebAuthn()` est une propriété du navigateur : le serveur ne
peut pas la connaître. La liste, elle, est rendue par le serveur et reste
visible partout — révoquer une passkey depuis un poste incompatible doit rester
possible.

**Le renommage se fait ligne par ligne, et une seule à la fois.** Un champ par
ligne donnerait *n* contrôles portant le même nom accessible ; ici, « Renommer »
ouvre le champ sur cette ligne, et le referme sur les autres.

### 2. `/sign-in` — un bouton de plus, au-dessus des fournisseurs

```
h1 « Se connecter »
[messages d'état : vérifiée / adresse changée / mot de passe réinitialisé]
Alert destructive (refus de fournisseur)

Button outline pleine largeur « Se connecter avec une passkey »   ← s14, si supporté
Alert destructive (refus de passkey)                              ← s14

[boutons de fournisseur]  +  Separator « ou »
form mot de passe
h2 « Recevoir un lien de connexion » + form magic link
liens
```

**Aucune adresse email n'est demandée.** Le point d'entrée du serveur ne prend
aucun paramètre et ne consulte l'existence d'aucun compte (recherche §8) : le
navigateur propose les passkeys qu'il détient. Conditionner le bouton à une
adresse saisie rétablirait exactement l'oracle que ce parcours n'a pas.

Le bouton est **au-dessus** des fournisseurs et non sous le formulaire de mot de
passe : c'est le moyen le plus rapide quand il est disponible, et le placer en
bas en ferait un dernier recours alors que c'est le premier choix. Il reprend la
forme des boutons de fournisseur — `outline`, pleine largeur — parce qu'il pose
la même question : « entrer autrement ».

## Composants employés

| Composant | Rôle ici | Origine |
|---|---|---|
| `Card` + `CardHeader/Title/Description/Content` | la carte de `/account` | `@repo/ui` |
| `EmptyState` | aucune passkey enregistrée | `@repo/ui` (composé maison) |
| `Alert` (`destructive`) | le refus, en une classe | `@repo/ui` |
| `Button` (`default`, `outline`, `destructive`, `ghost`) | enregistrer, renommer, révoquer, annuler | `@repo/ui` |
| `Input`, `Label` | le nouveau nom | `@repo/ui` |

**Aucun composant nouveau dans `packages/ui`. Aucun token nouveau.**

L'`EmptyState` du design system est employé **pour la première fois** ici (« Un
tableau vide sans action est un écran cassé », § États) : c'est le cas qu'il
décrit — une liste vide, avec l'action qui en sort.

## Design system gap — signalé, non comblé

Un seul, et c'est le même que s13 a laissé ouvert sous une autre forme : **il
n'existe pas de composé « ligne d'objet révocable »**. `/account` en porte
désormais trois — sessions actives, connexions externes, passkeys — et les trois
ont la même anatomie : un libellé, une date, une action destructrice, et un
texte de remplacement quand l'action est refusée par une règle.

Signalé, **pas comblé** : la story ne crée pas de primitive. La troisième
occurrence compose comme les deux premières, avec les mêmes classes utilitaires
(`flex`, `border-t border-border`, `text-xs text-muted-foreground`). Le jour où
une quatrième arrive, c'est un composé à nommer dans `docs/design-system.md`.

## Formulaires — les deux règles héritées

`docs/design-system.md`, § « Avant l'hydratation ». Un seul `<form>` dans cette
story — le renommage —, et il les porte toutes les deux : `method="post"` écrit
en toutes lettres, bouton désactivé jusqu'à l'hydratation.

Les autres actions (enregistrer, révoquer, annuler) sont des `Button` sans
formulaire : une cérémonie WebAuthn **ne peut pas** partir d'une soumission
native, elle demande `navigator.credentials`. Le bouton n'existe donc que sous
JavaScript — c'est l'état de fait de la fonctionnalité, pas une régression.

## États

| État | Traitement | Règle |
|---|---|---|
| Chargement | le bouton porte `pending` pendant la cérémonie ; aucun écran de chargement | § États |
| Vide | `EmptyState` avec l'action qui en sort | § États |
| Erreur | `Alert` `destructive` **au-dessus** de la liste, avec quoi faire | § Formulaires |
| Succès | changement d'état visible : la liste se recharge depuis le serveur. Pas de toast | § Feedback |
| Non supporté | le bouton d'enregistrement n'est pas rendu ; rien ne le remplace | critère 4 |

**Le cas « non supporté » ne porte pas de message.** Un bandeau « votre
navigateur ne gère pas les passkeys » sur chaque chargement de `/account` serait
du bruit permanent pour quelqu'un qui n'y peut rien. Le critère demande que
l'option soit masquée et que les autres moyens restent accessibles : les six
autres cartes ne bougent pas.

## Refus — une classe, jamais un code de bibliothèque

Même discipline que les deux classes de refus de fournisseur (s12) et les trois
du second facteur (s13) : l'écran **relit** une classe, il ne reclasse pas.

| Classe | Quand | Ce que le message dit |
|---|---|---|
| `stale` | la session est trop ancienne pour enrôler un moyen de connexion | « Reconnectez-vous, puis réessayez. » |
| `last-method` | c'était le dernier moyen de connexion du compte | « C'est votre dernier moyen de connexion. » |
| `refused` | tout le reste : cérémonie échouée, justificatif déjà connu, nom refusé | « L'enregistrement a échoué. Réessayez. » |
| `cancelled` | la personne a fermé la fenêtre du système — **côté navigateur**, aucune requête | « Enregistrement annulé. » |

Aucun `PASSKEY_NOT_FOUND`, `CHALLENGE_NOT_FOUND`, `AUTHENTICATION_FAILED` ni
`SESSION_NOT_FRESH` n'atteint le navigateur.

Sur `/sign-in`, une seule classe sort : **`refused`**. Distinguer « aucune
passkey ne correspond » de « la signature est fausse » dirait à un visiteur
anonyme si un justificatif est connu du serveur (`docs/security.md` §7).

## Accessibilité

- l'`Alert` de refus porte `role="alert"` — même convention que `AccountForm`,
  `ConnectionList` et `TwoFactorCard` ;
- chaque bouton « Révoquer » et chaque bouton « Renommer » portent un nom
  accessible **qui nomme leur passkey** (`aria-label` « Révoquer la passkey
  {name} »), comme les boutons de révocation de session le font déjà : trois
  boutons « Révoquer » identiques dans une liste ne se distinguent pas au
  lecteur d'écran ;
- le bouton d'enregistrement du renommage s'appelle **« Enregistrer ce nom »**
  et non « Enregistrer » : l'écran porte déjà « Enregistrer le nom » (carte
  Profil) et « Enregistrer une passkey ». Trois contrôles nommés
  « Enregistrer… » sur un même écran doivent au moins être distincts — c'est la
  règle que s13 avait déjà rencontrée sur deux champs « Mot de passe actuel » ;
- le champ de renommage porte un `Label` associé, et il n'y en a **qu'un** à
  l'écran à la fois ;
- le bouton de connexion par passkey est un vrai `button`, atteignable au
  clavier, avant les boutons de fournisseur dans l'ordre du document.

## Responsive

Rien de spécifique. Les lignes de passkey reprennent la composition des lignes
de session : `flex-col` sous `sm`, `flex-row` au-delà, avec `justify-between`.
Le point à vérifier au navigateur reste le même — pas de débordement horizontal
sous 400 px avec un nom long, qui est tronqué (`truncate`).

## Textes

Toutes les chaînes passent par les catalogues de l'application
(`apps/web/messages/{fr,en}.json`), sous `app.account.passkeys.*` et
`app.signIn.passkey.*`. Les deux écrans concernés sont **déjà** dans
`tests/rendered-text.test.ts` avec leur champ `refuses` : `/account` (connecté)
et `/sign-in` (anonyme). Aucun fichier d'écran nouveau, donc aucune entrée
nouvelle dans la liste — la garde d'inertie de ce test reste satisfaite.
