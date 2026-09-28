# Design — Story s62c-barre-du-haut

> **Écran dérivé** : la barre du haut (`apps/web/app/app-shell.tsx:111-174`), la zone Réglages (`app/(app)/app/settings/layout.tsx`) et la carte des préférences (`notifications-screen.tsx:238-256`) existent déjà. Pas de maquette : ce document décrit les **écarts**. Vérification visuelle au navigateur en fin d'Execute. Aucun composant, jeton ni couleur nouveau.

## Écrans de référence et écarts

### 1. Barre du haut de l'application (`AppShell`)
Grappe de droite (`app-shell.tsx:127`), dans cet ordre :

| Élément | Avant | Après |
|---|---|---|
| Sélecteur d'organisation | absent | **ajouté en tête de la grappe** : `OrgSwitcher` existant (`packages/ui`), libellé = organisation courante, ou « Choisir une organisation » si le compte en a sans en avoir choisi. **Absent** si `organizations` est coupé, ou si le compte n'appartient à aucune organisation |
| `LocaleSwitcher` | présent si plusieurs langues | inchangé |
| `ThemeToggle` | présent | inchangé |
| Cloche | lien vers `/notifications`, `Badge` des non-lus | inchangée (lien vers le centre, compteur) ; **absente** si `notifications` est coupé |
| Menu de compte | « Réglages », « Déconnexion » | inchangé |

- **Mobile (< md)** : le sélecteur d'organisation passe **dans le `Sheet` de navigation** (en tête, au-dessus des entrées), pour ne pas surcharger la barre ; la cloche et le menu de compte restent dans la barre.
- Changer d'organisation **reste sur l'écran courant** (le formulaire du sélecteur porte le chemin courant ; le serveur le filtre).

### 2. Barre latérale de l'application
- L'entrée **Notifications** disparaît (elle n'a plus de surface `app`). Il ne reste que les pages du produit (entrées de démonstration aujourd'hui).
- Le centre de notifications reste servi à son adresse actuelle et s'atteint par la **cloche**.

### 3. Zone Réglages — nouvelle rubrique **Notifications**
- Ordre de la sous-navigation : Profil · Sécurité · **Notifications** · Organisation · Membres · Facturation · Cookies (les réglages personnels d'abord, ceux de l'organisation ensuite).
- Contenu : **la carte des préférences existante**, déplacée telle quelle (un interrupteur par type et par canal), sous le `h2` « Notifications » de la rubrique (règle du titre unique de s62b).
- Le centre de notifications **ne porte plus** la carte ; son état vide qui renvoyait à `#notification-preferences` renvoie désormais vers la rubrique.
- Rubrique absente si `notifications` est coupé.

### 4. Carte « Organisation courante » (rubrique Organisation)
- Le sélecteur **quitte** la carte (il vit dans la barre du haut) : la carte devient **informative** — nom de l'organisation courante et `Badge` du rôle, plus une phrase « Changez d'organisation depuis la barre du haut ». Pas de second sélecteur sur la même page.

## States
- **Aucune organisation** : pas de sélecteur dans la barre ; la rubrique Organisation garde son état vide actuel (créer une organisation).
- **Organisations sans organisation courante** : sélecteur « Choisir une organisation ».
- **Modules coupés** : sélecteur absent sans `organizations` ; cloche et rubrique Notifications absentes sans `notifications`.
- **Retour du changement d'organisation** : écran courant ; chemin refusé par le filtre → rubrique Organisation (comportement actuel).
- **Sans JavaScript** : `OrgSwitcher` garde son repli `<noscript>` de boutons.

## Design system gaps
Aucun nouveau. Rappel : `PageHeader` n'a pas de niveau (lacune de s62b) — la rubrique compose son `h2` en ligne comme les autres.
