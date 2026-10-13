# ADR 062 — L'archive d'export vit dans la base, jamais dans le stockage d'objets

- Status: accepted
- Date: 2026-09-06

Une archive d'export est une copie complète des données personnelles d'un périmètre ; l'endroit où elle attend son téléchargement décide de ce qui l'efface. Un seau d'objets n'a aucune clé étrangère vers le compte, et le module `storage` est optionnel — un export qui en dépendrait cesserait d'exister là où il est coupé.

**L'archive est écrite en JSON dans `auth_data_export_request.archive`**, la ligne de la demande qui l'a produite. Elle hérite de deux effacements tenus par la base : la cascade de `requested_by` vers `auth_user`, et la purge du contrat du module `auth`, seule à couvrir le périmètre organisation, dont `scope_id` ne porte aucune clé étrangère (ADR 018). À l'échéance, l'archive est effacée et la ligne reste comme trace de la demande. L'effacement des archives échues est déclenché par la tâche `auth.data-export` quand le module `jobs` est activé, **et** à chaque nouvelle demande d'export (`forgetExpiredArchives`), qui existe dans toutes les configurations.

L'archive est entièrement en JSON : l'export du module `storage` rend un manifeste (identifiant, usage, type, taille, date) sans la clé d'objet ni les octets.

## Considered options

- **Le port `Storage`** — rejeté : l'archive survivrait à l'effacement du compte sans un effacement écrit à la main, et l'export dépendrait d'un module optionnel.
- **Reconstruire l'archive à chaque téléchargement** — rejeté : le lien deviendrait un déclencheur de travail serveur sur une route publique, et deux téléchargements rendraient deux contenus.
- **Le disque du conteneur** — rejeté : le conteneur est jetable, et deux instances ne partagent pas leur disque.
- **Chiffrer l'archive avec une clé dérivée du jeton** — écarté pour l'instant : l'archive deviendrait illisible pour l'exploitant ; à reprendre quand le socle aura une gestion de clés.

## Consequences

- Sans ordonnanceur et sans nouvelle demande, les archives échues restent en base jusqu'à l'effacement du compte ; le lien, lui, refuse dès l'échéance.
- Le manifeste ne porte aucune empreinte : la personne apprend qu'un fichier existe, pas comment vérifier celui qu'elle obtiendra ailleurs. La portabilité des octets demanderait une autre forme d'archive et une ADR.
- Une archive volumineuse est une ligne `jsonb` volumineuse, lue d'un bloc ; rien ne la borne (issue #91).
