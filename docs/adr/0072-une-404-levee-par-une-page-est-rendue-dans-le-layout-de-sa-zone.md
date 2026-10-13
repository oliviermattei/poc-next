# ADR 072 — Une 404 levée par une page est rendue dans le layout de sa zone

- Status: accepted
- Date: 2026-09-27

Dans l'App Router, toutes les 404 ne passent pas par la même frontière : un `notFound()` levé par une **page** est rendu par la frontière `not-found.tsx` la plus proche, sous les layouts de ses segments ; un `notFound()` levé par un **layout** est rendu par la frontière du segment parent (celle du segment est sous son propre layout) ; une URL sans route n'a que le layout racine. Une seule frontière racine qui rendrait le gabarit donnait donc deux shells pour la 404 d'une page de zone. La différence n'apparaît que dans un navigateur : la 404 d'une page part dans le flux RSC, le HTML brut n'en montre qu'une.

D'où deux sortes de frontières. `apps/web/app/not-found.tsx` rend son gabarit lui-même — celui du Site — et ne sert que l'URL sans route et le refus d'un layout de zone. `app/(site|auth|app|console)/not-found.tsx` rendent `NotFoundScreen` sans shell : le layout de la zone l'entoure déjà. Le refus de la garde de `(console)/layout.tsx` remonte donc à la 404 racine, sans rien du shell de la console ; seul le superadmin, sur un identifiant inconnu, voit une 404 dans la console — il sait déjà qu'elle existe.

## Considered options

- **Aiguiller le shell de la 404 racine par un en-tête posé par `proxy.ts`** — rejeté pour la raison de l'ADR 071 : un aiguillage écrit à la main là où Next fournit une frontière par segment.
- **Aucune frontière dans `(console)`** — rejeté : le superadmin sur un identifiant inconnu verrait deux shells.

## Consequences

Une 404, un shell, dans chaque zone : `e2e/not-found-zones.spec.ts` compte les gabarits après l'affichage de l'écran 404, et le témoin de la console vit dans `e2e/admin.spec.ts`, seule série qui inscrit le superadmin. Avec tous les modules activés, `(auth)` et `(app)` n'ont pas de page qui lève `notFound()` sur une URL atteignable : leurs cas sautent en le disant et mordent dans la configuration `socle`.
