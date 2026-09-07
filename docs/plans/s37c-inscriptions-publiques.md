---
story: s37c-inscriptions-publiques
validated: yes
---

# Plan — s37c-inscriptions-publiques

> Planifié contre `dev` au commit `57e1763`. La recherche est sur `dev`, datée d'un commit plus tôt.

## Ce qui existe, et ce qui manque

**L'index qui sert cette story existe depuis `s11`**, et son commentaire la nomme : *« la question que le back-office de s37 posera : qui est inscrit à quoi »*. **La requête n'existe pas** — les ports du module savent lire **une** adresse (pour l'export et la purge d'un visiteur), jamais une source.

**Le back-office n'a aucun chemin d'export**, d'aucune sorte : balayage du module `admin` sur sept motifs, zéro occurrence. Et **l'export de `s35` répond à une autre question** : un objet JSON lié à une **portée personnelle**, jamais un fichier (ADR 062). « Tous les inscrits à telle source » est une question d'administration, sur un autre axe.

**Il n'existe aucun écrivain CSV dans le dépôt**, donc aucun assainisseur d'injection de formule.

## Les deux décisions du plan

**1. CSV, et non JSON.** La story dit « exporter » sans nommer le format ; `s11` avait écrit « export CSV » en reportant explicitement le sujet à cette tranche. Le CSV est ce qu'un exploitant ouvre. Il est aussi le seul qui **demande** un assainisseur — et c'est précisément pour ça qu'il vaut d'être fait ici plutôt que remis.

**2. L'export suit la sélection affichée** — source, recherche. Un export qui ignore le filtre à l'écran surprend celui qui l'a posé. Le fichier le **dit** dans son nom.

## La seule surface de sécurité de la story

**L'injection de formule.** Une cellule commençant par `=`, `+`, `-` ou `@` est exécutée par un tableur à l'ouverture. Ces adresses et ces messages viennent d'**inconnus** : c'est une entrée hostile qui traverse un fichier que quelqu'un ouvrira sur son poste. Assainir, et **le mesurer sur le fichier produit**, jamais sur l'intention.

## Tâches

- [x] **1. La lecture par source, par le port.** Élargir `MarketingSubscriptionsPort` comme `s37b1` puis `s37b2` ont élargi le leur. Aucune lecture directe des tables depuis `admin` — le balayage a confirmé qu'aucun code de production hors du module ne les lit, et cette story ne doit pas être la première.
- [x] **2. L'écran, dans le cadre existant.** La garde `authorize` de `s37b2` — **une seule, appelée par les routes et par les vues**, la revue a vérifié qu'il n'en existe aucune seconde copie. `Table`, `Pagination` fenêtrée, `EmptyState`. **404 et non 403** pour un non-superadmin, mesuré sur le vrai chemin HTTP.
- [x] **3. Le filtre par source**, dérivé des sources réellement présentes plutôt que d'une liste écrite — un jour il y aura `waitlist` (`s42` est en cours), et cet écran ne doit pas avoir à le savoir.
- [x] **4. L'écriture CSV, et son assainissement.** Une cellule dont le premier caractère est `=`, `+`, `-` ou `@` est neutralisée. Guillemets, points-virgules, retours à la ligne échappés. Mutation : retirer l'assainissement doit rougir **sur le contenu du fichier**.
- [x] **5. La route de téléchargement**, sur la forme que le dépôt possède déjà : `content-disposition: attachment`, `cache-control: no-store`, et le refus **entier** plutôt que le fichier tronqué — la discipline de `s35`.
- [x] **6. Les messages de contact, ou non — tranché et écrit.** Les deux tables sont voisines et distinctes ; la story parle d'« inscriptions ». **Décision : l'écran couvre les inscriptions, pas les messages de contact**, et l'écrit là où quelqu'un cherchera pourquoi.
- [x] **7. Module `marketing` coupé** : l'entrée disparaît du back-office, dérivée du registre, sans qu'aucun fichier ne nomme le module — la forme de `s31` puis de `s37b2`. **La recette qui le tient est `pnpm test:socle`** : c'est la seule des deux qui coupe `marketing` — `config/profiles.ts` coupe `admin`, pas le site public, si bien que `pnpm test:minimal-profile`, écrit ici d'abord, ne mesure rien de ce critère. La correction vient de la revue (constat 4), et elle n'est pas cosmétique : la branche `socle` de la CI est **la** configuration où cette story pouvait casser, et c'est là qu'elle a cassé.

## Ce que la story ne fait pas

Pas de format d'archive, pas de pagination d'export, pas de travail de fond — aucun critère ne les demande. Pas de suppression ni de modification d'une inscription : cet écran **consulte**. La purge d'une adresse existe déjà, elle appartient au visiteur (`s34`).

**Une limite à écrire plutôt qu'à résoudre** : rien ne borne aujourd'hui le nombre d'inscriptions, et un export qui matérialise tout en mémoire tiendra jusqu'à ce qu'il ne tienne plus. Le dire dans le code, et laisser la borne à la story qui verra le problème.

## Sections de `docs/security.md` touchées

**404 plutôt que 403** pour un non-superadmin. **Autorisation vérifiée côté serveur**, avant toute lecture. **Aucune donnée hostile rendue exécutable** — c'est la tâche 4, et c'est la raison d'être sécuritaire de cette story. Le fichier n'est pas mis en cache.
