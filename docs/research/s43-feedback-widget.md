# Research — Story s43-feedback-widget

> Vérifiée contre la branche par défaut au commit `d07f9ef`, en lecture seule.

## Les six faits structurants

1. **Le critère 3 est déjà construit.** `apps/web/lib/notifications.ts` implémente exactement le repli que la story demande : le centre de notifications si le module est activé, un envoi direct sinon — décidé **par la valeur**, jamais par une condition sur un nom de module. La story n'a donc pas à construire ce mécanisme, seulement à l'appeler.

2. **`config/notifications.ts` nomme cette story.** Le registre des types y écrit : *« les stories qui possèdent un événement (s37, s43) appellent l'émission avec le type qui leur correspond »*. Un retour est une **quatrième ligne** de ce registre, pas un mécanisme neuf. Et ce fichier appartient au **socle**, pas au module (ADR 057) : un catalogue vivant dans le contrat d'un module disparaîtrait avec lui, en emportant les emails.

3. **Le widget est le premier bouton flottant du dépôt.** Balayage : trois sources d'ancrage au viewport existent — le panneau latéral (modal, Radix), la palette, et la bannière de consentement. **Aucun bouton flottant.** La bannière est le précédent utile : `role="region"`, **non modale**, formulaire natif sans état React ni `fetch`, donc fonctionnelle sans JavaScript, et **rien en ligne** — élévation par bordure et fond.

4. **La leçon la plus chère du dépôt sur ce sujet est écrite dans la coquille applicative** : la bannière réserve sa place (`pb-64 md:pb-36`) parce que, posée en surface fixe **sans réserver son espace, elle a intercepté les clics de dix parcours**. Mesurée à 241 px de haut à 390 px de large. Ce n'était pas un défaut de test : un visiteur ne pouvait pas atteindre le bas de la page — la bannière était **accidentellement modale**.

5. **La CSP interdit le chemin le plus court.** `style-src` ne porte `'unsafe-inline'` **qu'en développement** : un widget positionné par attribut `style`, ou animé par une feuille injectée à l'exécution, est **refusé en production et silencieux en développement**. Classes Tailwind uniquement. Et si le widget ouvre une surface flottante Radix, il hérite d'une feuille créée à l'ouverture — ce que le nonce en ligne rend légal, à condition d'être rendu **avant**.

6. **Le widget est authentifié, donc la limitation ne vient pas toute seule.** Le répartiteur limite **toute** route publique par dérivation, plus celles qui déclarent une politique. Une route de retour est `authenticated` : elle **doit déclarer** `rateLimit` explicitement, sinon elle n'est pas limitée du tout.

## Points d'ancrage

- `apps/web/lib/notifications.ts` — le repli, déjà livré.
- `config/notifications.ts` — le registre, ses trois types, et la phrase qui nomme cette story.
- `packages/ui/src/composed/cookie-banner.tsx` — le précédent d'une surface ancrée non modale et sans script.
- `apps/web/app/app-shell.tsx` — la réservation d'espace, et la mesure qui l'a imposée.
- `apps/web/app/public-form.tsx` — le composant partagé, sa classification des refus **par statut avant corps**, et son `Retour-After` arrondi.
- `packages/modules/admin/src/presentation/back-office-screens.tsx` — le cadre du critère 4, sa garde unique, sa `Table`, ses filtres qui **portent la sélection** (corrigé par `s37c`).

## Pièges & contraintes

- **`Dialog`, `Popover`, `Tooltip` sont déclarés par le design system et absents de `packages/ui`.** Composer avec l'un d'eux **ne compile pas**. Soit le widget réutilise ce qui existe, soit il **livre le composant manquant** (copie shadcn/ui sur Radix, ADR 022) et corrige la note datée — jamais une réimplémentation dans le module.
- **Le critère 2 demande l'URL de la page d'origine.** C'est une donnée fournie par le client : elle se valide, se borne, et ne se rend jamais telle quelle dans un écran d'administration sans échappement.
- **Un retour porte un auteur et une organisation** : ce sont des données personnelles. Les quatre clés RGPD du contrat doivent être remplies, et `s34`/`s35` ont laissé les commandes qui le mesurent.
- **La story ne requiert pas le module de notifications** — c'est le critère 3 qui l'énonce, et la note de la story le confirme. Le `requires` nomme le back-office.

## Questions ouvertes

- **Où vit le widget ?** Dans la coquille applicative, comme la bannière, ou dans une page ? La coquille le rend disponible partout, ce que « depuis le tableau de bord » suggère — mais elle est du socle, et un module coupé doit n'y laisser aucune trace.
- **Le widget fonctionne-t-il sans JavaScript ?** La bannière, oui, délibérément. Un widget qui s'ouvre demande un état ; un formulaire sur une page à part n'en demande aucun.
- **Le statut « traité » est-il binaire ou un cycle ?** Le critère 5 dit « marqué comme traité » ; le critère 4 parle de filtrer par statut. Deux valeurs suffisent à satisfaire les deux.

## Complexité réelle

Notée **2**. **Ma note : 3.** Le repli de notification est livré, le cadre de back-office aussi — mais le widget est le **premier élément flottant du dépôt**, dans une CSP qui interdit sa mise en œuvre la plus courante, avec une leçon mesurée sur l'interception des clics, et un composant manquant à livrer si le panneau doit flotter.
