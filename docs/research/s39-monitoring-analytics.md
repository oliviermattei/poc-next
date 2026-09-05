# Research — Story s39-monitoring-analytics

> Vérifiée contre la branche par défaut au commit `6f28e5f`, en lecture seule.
> Aucune base, aucun conteneur, aucun worktree.

## Les cinq faits structurants

1. **s36 a déjà construit le crochet, et la story n'a qu'à s'y brancher.** `packages/modules/consent/src/domain/consent-category.ts` déclare `CONSENT_CATEGORIES = ['analytics', 'advertising']` et une interface `NonEssentialScript`. Le critère 6 — « le script d'analyse est déclaré comme non essentiel auprès du registre de s36 » — est donc une **déclaration**, pas un mécanisme à écrire. C'est le meilleur cas de figure de cette famille : la story précédente a anticipé celle-ci.
2. **Le dépôt porte quatre ports pour trois adaptateurs.** `packages/ports/src/` : `mailer`, `payments`, `rate-limit`, `storage`. `packages/adapters/` : `resend`, `s3`, `stripe`. La story en ajoute **deux** — l'analyse et les erreurs — et `AGENTS.md` les nomme déjà dans sa liste « une implémentation par port » (« errors Sentry, analytics PostHog »). Le contrat de port est donc connu : **il ne lève jamais**, il rend un résultat discriminé.
3. **Ces deux ports dégradent, là où celui de s28 refuse — et la distinction est écrite.** `docs/reliability.md` : « un tiers absent **dégrade**, il ne casse pas. Pas d'analytics → l'application tourne. » C'est exactement le critère 5. À l'inverse, ADR 050 fait **refuser** le port de limitation quand son magasin est absent, parce que son magasin est la base de l'application. La story doit citer la bonne moitié de la règle, et `packages/ports/AGENTS.md` porte déjà l'exception de s28 — donc l'ajout de deux ports qui dégradent **remet la règle générale en majorité**, ce qui est bon à écrire.
4. **Le critère 4 impose les deux régimes que le dépôt pratique déjà.** « En CI, les requêtes d'analyse sont capturées et assertées ; hors CI, sur commande explicite, un test contre un projet PostHog de test vérifie l'envoi réel. » C'est mot pour mot la règle d'`AGENTS.md` (« doublures d'enregistrement en CI, clés de test réelles hors CI, jamais mélangés ») — et le dépôt a déjà payé pour l'avoir mal tenue : le régime `recorded` du parcours doré **n'a jamais tourné sur des formes Stripe réelles**, `tests/fixtures/stripe-events/` ne porte aucun enregistrement, et le job de CI ne s'arme qu'à la première capture versionnée. La story ne doit pas reproduire cette moitié-là.
5. **Le critère 2 est une garantie de sécurité, et c'est le seul de la story qui en soit une.** « Les données sensibles sont filtrées **avant envoi** ; un test soumet une charge utile contenant ces champs et asserte leur absence dans la requête capturée. » `docs/security.md` interdit déjà qu'un secret atteigne un journal, une réponse d'erreur **ou la télémétrie**. Le critère demande donc la preuve d'une règle qui existe — et il la demande au bon endroit, sur la requête capturée, pas sur l'intention.

## Target story

Huit critères : erreurs serveur et client remontées avec leur trace source lisible · **filtrage des données sensibles, prouvé sur la requête capturée** · une interface `Analytics` typée, **seule surface appelée par le code métier** · deux régimes de test, capture en CI et envoi réel sur commande explicite · **sans clé, l'application tourne et n'émet aucun appel** · le script déclaré non essentiel auprès du registre de s36, aucun chargement ni événement sans consentement · un événement de démonstration suivi de bout en bout · **module coupé** : aucun script, aucune remontée, et la bannière ne s'affiche plus faute de script non essentiel.

Dépendance déclarée : `s36-cookie-consent` — fusionnée.

## Points d'ancrage

- `packages/modules/consent/src/domain/consent-category.ts` — `NonEssentialScript`, `CONSENT_CATEGORIES`, `ConsentDecisions`.
- `packages/ports/src/` et son `AGENTS.md` — le gabarit d'un port, la forme du journal, et l'exception de s28 à la règle « un tiers absent dégrade ».
- `packages/adapters/resend/`, `s3/`, `stripe/` — les trois implémentations livrées, dont la forme est le modèle.
- `apps/web/lib/security-headers.ts` — la CSP, que tout script tiers oblige à rouvrir.
- `docs/reliability.md` §2 et `docs/security.md` — les deux règles que les critères 5 et 2 demandent de prouver.

## Pièges & contraintes

- **La CSP est le vrai coût de cette story.** `script-src` vaut `'self'`, le nonce et `'strict-dynamic'` ; `connect-src` vaut `'self'`. Charger PostHog et Sentry demande **d'ajouter des origines**, ce que le socle de sécurité soumet à « une justification écrite dans la story ». C'est la seule story du backlog qui doive légitimement toucher la politique.
- **Le consentement doit précéder le chargement, pas seulement l'événement.** Le critère 6 dit « aucun chargement **ni** événement ». Un script chargé puis muselé aurait déjà contacté son origine.
- **Les cartes de source envoyées au build ne doivent pas être servies publiquement** — elles rendent le code serveur lisible. Le critère demande une trace lisible **chez Sentry**, pas dans le navigateur du visiteur.
- **Le critère 8 a une conséquence inattendue et juste** : module coupé, la bannière de consentement **disparaît**, faute de script non essentiel à déclarer. C'est le comportement dérivé que s36 a construit — à vérifier, pas à recoder.
- **Ne pas inventer un second adaptateur** : une implémentation par port, et les doublures de test ne sont pas des fournisseurs.

## Questions ouvertes

- **Les erreurs sont-elles un port, ou une configuration ?** `AGENTS.md` les nomme dans la liste des ports (« errors Sentry »), mais les critères ne nomment d'interface que pour l'analyse. Sentry s'installe surtout par instrumentation globale, ce qui se prête mal à un port appelé par le code métier. À trancher au plan, avec ADR si la réponse est « pas un port ».
- **Quelles origines exactement, et pour quelles directives ?** PostHog et Sentry demandent chacun `script-src` et `connect-src`, parfois `worker-src`. La justification écrite doit les **énumérer**, et un test devrait les dériver de la configuration plutôt que les recopier — le dépôt a déjà une garde qui assère que `script` et `frame` restent vides.
- **Que capture-t-on en CI ?** Le critère dit « les requêtes d'analyse sont capturées et assertées ». Une doublure qui remplace le **réseau** est la bonne frontière (règle du dépôt) ; une doublure qui remplace le SDK ne prouverait rien du filtrage du critère 2.
- **L'événement de démonstration doit-il vivre dans un module ?** « Inscription réussie » appartient à `auth`, qui est du socle. Un module de socle qui appellerait l'analyse créerait la dépendance inverse — le socle vers un module optionnel. **C'est la forme symétrique du contrat, celle que s32 doit trancher** : s39 en dépend sans le déclarer.
- **Sans clé, « aucun appel réseau » se prouve comment ?** Il faut observer l'absence, ce qui demande la même doublure de réseau que le critère 4.

## Complexité réelle

Notée **2** dans `docs/stories.md`. **Ma note : 4.**

Le branchement au registre de s36 est acquis (fait 1) et la forme d'un port est connue (fait 2). Mais huit critères, **deux** ports, **deux** adaptateurs, une garantie de sécurité à prouver sur une requête capturée, deux régimes de test dont le dépôt a déjà raté un, **et l'ouverture de la CSP** — la seule story du backlog qui doive y toucher. La note de 2 tient si l'on ne compte que la plomberie ; elle ignore la politique de sécurité et le doublement des surfaces tierces.

**Proposition de découpe, à trancher au plan** : les **erreurs** (Sentry, cartes de source, filtrage des données sensibles) d'un côté ; l'**analyse** (interface `Analytics`, PostHog, consentement, événement de démonstration) de l'autre. Elles ne partagent que la CSP, et la première porte la garantie de sécurité tandis que la seconde porte le consentement — deux revues de nature différente.

**Dépendance non déclarée à surveiller** : la question ouverte n°4 fait dépendre l'événement de démonstration de la forme symétrique du contrat, que **s32** doit trancher. Si s32 passe avant, s39 hérite du mécanisme ; sinon elle devra le contourner ou l'inventer.
