# ADR 033 — Une URL présignée ne désigne jamais l'objet servi

- Status: accepted
- Date: 2026-09-01

Aucun fournisseur ne permet de révoquer une URL présignée : elle vaut jusqu'à son échéance. Rejouée après la confirmation, elle remplaçait l'objet vérifié par des octets arbitraires de même longueur et de même type signé, que la route de lecture servait ensuite. `nosniff`, le type pris en base et `default-src 'self'` empêchent l'exécution, mais ce qui avait été vérifié et ce qui était servi cessaient d'être la même chose.

**Deux espaces de clés, et l'URL présignée ne connaît que le premier** (`KeySpace`, `domain/avatar.ts` du module `storage`) : `pending/<kind>/<id>/<hasard>.<ext>`, la clé d'attente, seule qu'une URL présignée nomme ; `avatars/<kind>/<id>/<hasard>.<ext>`, la clé servie. À la confirmation, l'application lit l'objet d'attente, vérifie ses octets, **écrit elle-même ces octets vérifiés** vers la clé servie (`Storage.write`), retire l'objet d'attente et enregistre la ligne sur la clé servie. L'objet promu est la copie mémoire déjà validée : un rejeu entre la lecture et l'écriture ne touche que l'objet d'attente, que plus rien ne promeut. Confirmer deux fois la même clé d'attente rend 404.

`Storage.write` n'est pas une voie de téléversement : elle n'écrit que des octets déjà en notre possession, plafonnés à 2 Mio.

## Considered options

- **Réduire la durée de vie de l'URL** — rejeté : la fenêtre rétrécit sans se fermer, et un téléversement lent la rouvre.
- **Un jeton d'usage unique consommé à la confirmation** — rejeté : empêche de confirmer deux fois, pas de réécrire l'objet.
- **Revérifier les octets à chaque lecture** — rejeté : déplace un coût rare (téléversement) vers un coût fréquent (chaque affichage).
- **`CopyObject` côté fournisseur** — rejeté : entre la lecture vérifiée et la copie, un rejeu remplace la source, et la copie promeut des octets non vérifiés.

## Consequences

Un avatar accepté est écrit deux fois dans le seau. Un futur module de fichiers volumineux rouvrira la question, probablement par une vérification différée, pas par un retour à la clé unique.

Les objets d'attente jamais confirmés ou réécrits après coup ne sont connus d'aucune purge ; la règle de cycle de vie du seau (ADR 032) vise le préfixe `pending/` entier, où aucun objet servi ne vit.
