# ADR 051 — Le seau de défi 2FA compte la valeur que le serveur lit, et il mord avant le plafond de la bibliothèque

- Status: accepted
- Date: 2026-09-04

Les routes de second facteur sont limitées par défi, à partir du cookie de défi que le serveur pose et signe (`subjectCookies` du contrat de route : des noms exacts, au pluriel parce que le nom réel dépend de `useSecureCookies` ; quand plus d'un est présent, la limitation refuse au lieu de choisir). Ce qui compte est la **valeur**, pas seulement le nom : `better-call` détrime la valeur, retire ses guillemets encadrants puis la décode (`decodeURIComponent` quand elle contient un `%`, la valeur brute si le décodage lève). L'en-tête `Cookie` étant écrit par l'appelant, toute autre normalisation lui permet d'envoyer le même défi sous plusieurs encodages et de scinder son propre seau.

**La normalisation appartient au lecteur** : `subjectOfCookies` (`packages/modules/rate-limit`) refait, dans cet ordre, les trois gestes de la bibliothèque et ne lève jamais — une exception sur un en-tête d'attaquant serait un 500 sur une route publique. `subjectBucketKey` ne normalise plus rien : deux normalisations concurrentes sont exactement le défaut.

**`twoFactor.maxPerSubject` vaut 4, sous le plafond de `better-auth`**, qui détruit un défi au cinquième essai. Ce seuil mord donc le premier sur un défi authentique ; le plafond de la bibliothèque reste un second filet, et `tests/rate-limiting.test.ts` le dérive de la bibliothèque installée et refuse un seuil qui ne serait pas strictement en dessous. Un défi fabriqué, lui, est refusé par la bibliothèque sans jamais être compté : il n'est borné que par notre seau.

## Considered options

- **Normaliser plus fort que la bibliothèque** (minuscules, retrait des caractères non alphanumériques) — rejeté : toute normalisation qui n'est pas exactement celle du serveur fait diverger le seau de ce qui est validé.
- **Vérifier la signature du cookie dans le limiteur** — rejeté : le secret d'authentification entrerait dans le chemin de la limitation pour un besoin d'identité du seau, pas d'authenticité ; un défi fabriqué doit être compté.
- **Garder un seuil au-dessus du plafond de la bibliothèque** — rejeté : un seuil qui ne mord jamais le premier est un décor, et la protection dépendrait en silence du compteur d'une dépendance.

## Consequences

- Un utilisateur qui se trompe quatre fois dans la fenêtre reçoit un 429 plutôt qu'un cinquième « code invalide » ; le cinquième aurait de toute façon détruit son défi.
- Le test dérive le plafond de la bibliothèque, pas sa manière de lire un cookie : un changement de `parseCookies` dans `better-call` ne rougirait pas tout seul.
