# Research — Story s26-minimal-profile-check

## Bonne nouvelle d'abord : les trois mécanismes durs existent déjà

Contrairement à s25, cette story **compose** plutôt qu'elle n'invente. Trois
pièces sont en place et vérifiées :

1. **Lire le schéma réel de la base.** `packages/db/src/introspect.ts` interroge
   `information_schema` — « la seule vérification qui attrape ces trois cas ».
   Le critère 5 exige explicitement que la comparaison lise « le schéma réel de
   la base », pas les fichiers de migration ; le mécanisme est là, et
   `tests/module-migrations.test.ts:439` l'emploie déjà pour attraper « une table
   créée par un import transitif ».
2. **Basculer les modules et restaurer sur échec.** `packages/cli/src/apply.ts`
   photographie la configuration avant d'écrire et la restaure si la
   régénération échoue, avec un commentaire qui nomme le défaut évité : « la CI
   rejette, sans que l'utilisateur sache quoi restaurer ».
   `packages/cli/src/features-file.ts` expose `writeEnabledModules`.
3. **Refuser une configuration qui coupe un module du socle**
   (`tests/module-registry.test.ts:156`) et **répondre 404 sur un chemin
   qu'aucun module activé ne déclare** (`:539`). Le critère 3 s'appuie sur un
   comportement déjà éprouvé ; ce qui manque est de l'éprouver **sous le profil
   minimal**, les trois modules coupés ensemble.

## Le piège que la story nomme, et sa forme exécutable

> « Ce harnais doit rester générique. Un profil codé en dur avec trois noms de
> modules deviendrait faux dès le module suivant. »

Le critère 8 en est la version vérifiable : « Ajouter un module désactivé au
profil ne demande aucune modification du harnais. »

C'est le vrai sujet de cette story. Écrire une recette qui vérifie que
`organizations`, `billing` et `i18n` sont absents est facile — et sera faux au
dixième module. La recette doit **dériver** ce qu'elle vérifie du registre :
pour chaque module **non activé**, aucune de ses routes déclarées ne répond,
aucune de ses entrées de navigation n'est rendue, aucune de ses tables n'existe.
Le profil ne fournit que la liste des modules à couper ; tout le reste se déduit
du contrat que chaque module déclare déjà.

Formulé ainsi, le critère 8 se teste : ajouter un identifiant à la liste du
profil doit suffire, et un test peut le prouver en construisant un profil de plus
sans toucher au harnais.

## Les cinq faits structurants

1. **`enabledModules` est une liste plate** dans `config/features.ts:77`, et
   `availableModules` (`:33`) est l'annuaire des dix modules du dépôt. Le profil
   minimal est donc un **sous-ensemble**, pas une structure neuve.
2. **`requiredModules = ['auth']`** (`config/features.ts:68`) : le profil minimal
   ne peut pas couper `auth`, et le critère 6 (inscription et connexion de bout
   en bout) en dépend directement.
3. **Le contrat de module déclare déjà `routes`, `navigation` et `schema`** —
   c'est ce qui rend les critères 3, 4 et 5 dérivables sans recopier une liste.
4. **La restauration de configuration est un acquis**, mais elle protège le
   `ks toggle`, pas une recette qui bascule puis exécute une suite entière. Une
   recette interrompue au milieu laisserait le dépôt sur le profil minimal.
5. **s25 vient de livrer le motif de la commande unique** (`pnpm test:golden-path`,
   base vierge par exécution, régime explicite, durées journalisées). s26 est son
   symétrique et devrait lui ressembler plutôt que d'inventer une seconde forme.

## Pièges & contraintes

- **La recette écrit dans `config/features.ts`**, un fichier **suivi par git**.
  C'est la différence avec s25, dont l'amorçage travaillait dans un clone
  temporaire. Une recette qui bascule le dépôt de travail et meurt laisse un
  diff que personne n'a demandé — et le dépôt a déjà une règle pour ça
  (ADR 041, garde de dépôt propre pour les écritures pilotées par agent).
  **Travailler dans une copie, comme s25, évite le sujet entièrement.**
- **Le critère 5 dit « après migration sur base vierge ».** Une base réutilisée
  d'une exécution précédente porterait les tables des modules maintenant coupés,
  et la recette échouerait pour une raison fausse — ou pire, passerait après un
  nettoyage manuel que personne ne rejouera.
- **Le critère 2 dit « la suite de tests complète passe ».** Or de nombreux cas
  supposent les modules activés ; sous le profil minimal ils doivent **se
  sauter proprement**, pas échouer. Cette session a mesuré que 288 cas se
  sautaient en silence faute de base : un profil qui ferait sauter la moitié de
  la suite sans le dire donnerait un vert sans valeur. **Le compte de cas
  exécutés doit être journalisé**, comme s25 journalise ses durées.
- **`i18n` coupé change les URL** : le routage par préfixe disparaît
  (`apps/web/lib/locale-routing.ts`), donc les chemins du critère 3 ne sont pas
  ceux du profil complet. Les dériver, jamais les écrire.
- **Le critère 7 met la recette en CI, bloquante.** s25 vient d'apprendre à ce
  dépôt qu'une erreur de workflow n'est visible d'aucune commande locale : le
  garde `actionlint` et le test des `if:` de niveau job existent désormais et
  s'appliqueront à ce job aussi.

## Questions ouvertes

- **Où vit le profil ?** Un fichier de configuration versionné, une variable
  d'environnement, ou un argument de la commande ? Le critère 1 dit « un profil
  de configuration », le 8 exige qu'en ajouter un module soit indolore.
- **Le profil minimal est-il une deuxième configuration livrée**, que le
  propriétaire pourrait choisir, ou un artefact de recette ? La réponse change ce
  qui doit être documenté et ce que `pnpm ks list` doit en dire.
- **Que fait la recette d'un module qui n'a ni route ni navigation ni table** —
  `consent`, par exemple ? Une vérification vide qui passe est un faux positif ;
  il faut au moins compter ce qui a été balayé.
- **La suite complète sous profil minimal peut-elle vraiment passer ?** La
  recherche ne l'a pas exécutée. C'est la première chose que le plan devra
  mesurer, parce que le critère 2 en dépend et qu'un échec révélerait un couplage
  que personne n'a vu.

## Complexité réelle

`docs/stories.md` annonce **3**. Après lecture : **3**, confirmé.

Les trois mécanismes durs existent (introspection du schéma réel, bascule avec
restauration, refus 404 dérivé du registre), et s25 vient de livrer le motif de
la commande unique. Ce qui reste est de la composition et une exigence de
généricité — réelle, mais bornée, et le critère 8 la rend vérifiable.

Une réserve : si la suite complète **ne passe pas** sous le profil minimal, la
story découvrira un couplage caché et changera de nature. C'est le risque
principal, et il se mesure en une commande.

## Mesure faite par la recherche, et non laissée au plan

La question ouverte la plus lourde — « la suite complète passe-t-elle sous le
profil minimal ? » — a été **exécutée**, pas supposée. `pnpm ks toggle` sur
`organizations`, `billing` et `i18n`, puis le harnais complet.

| Profil | Résultat |
|---|---|
| complet | 1806 passés, 8 sautés, 0 échec |
| **minimal** (les trois coupés) | **1803 passés, 11 sautés, 0 échec** — `pnpm typecheck` vert aussi |

**Le critère 2 est atteignable, et l'écart est honnête** : trois cas basculent de
« passé » à « sauté », pas deux cents. Aucun couplage caché n'a été révélé. C'est
le principal risque de cette story, et il est levé avant le plan.

Configuration restaurée, schémas régénérés, `git diff --exit-code` propre.

### Ce que la première tentative a révélé au passage

Le premier passage rendait **5 échecs**, dont aucun n'était un couplage de
modules :

- trois `EnvValidationError: STRIPE_WEBHOOK_SECRET: is required when
  STRIPE_SECRET_KEY is set` — le garde d'environnement refuse une configuration
  de paiement **à moitié posée** plutôt que de démarrer avec un webhook
  invérifiable. Il fait exactement son travail, et il l'a fait sur une clé
  ajoutée au `.env` du poste quelques minutes plus tôt ;
- deux gardes d'inertie « la base de données de la suite est joignable » — le
  conteneur du worktree n'était pas levé.

Les deux enseignements valent pour le plan : la recette du profil minimal devra
**poser un environnement complet et une base vierge**, sinon elle échouera pour
des raisons étrangères au profil — et un lecteur pressé conclura à un défaut de
modularité qui n'existe pas.

### Conséquence sur le compte de cas sautés

Le profil minimal fait passer les sautés de 8 à 11. C'est peu, mais **c'est le
chiffre qui doit être journalisé** : une régression future s'y verrait, là où un
simple « suite verte » ne dirait rien. Cette session a déjà mesuré ce que coûtent
des cas qui se sautent sans le dire.
