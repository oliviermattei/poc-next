/**
 * **Les cas intermittents de s52, et l'état de chacun.**
 *
 * Un seul endroit, parce que trois comptes écrits ont vieilli avant lui — le
 * critère de la story disait « les trois », la recherche « sept cas sur quatre
 * fichiers » (il y en avait huit, sur cinq fichiers), le plan « onze ». Un
 * compte écrit à côté du code se lit comme vérifié : le suivant cherche trois
 * cas, en trouve trois, et attribue les autres à la prochaine story. La liste
 * est donc la source, et `tests/intermittents.test.ts` en vérifie le plancher.
 *
 * **Ce que cette liste dit** : ce qui a été balayé, sur les exécutions décrites
 * dans `regime`. Elle ne dit pas ce qui existe — un douzième cas rencontré
 * demain s'ajoute ici, il ne prouve pas que celle-ci mentait.
 *
 * **Ce qu'elle ne porte plus** : `tests/billing.test.ts`, qui comparait un
 * delta **global** de `auth_session`. s50 l'a remplacé par deux sondes ;
 * mesuré le 05/09 sur cette branche, `grep -c "countRows('auth_session')"
 * tests/billing.test.ts` rend **0**. Le cas est fermé par une autre story, il
 * est constaté ici plutôt que rejoué.
 *
 * La règle que la story s'est donnée et que le test rend exécutable : **on ne
 * corrige pas sur une hypothèse**. `corrected` sans `established` est refusé.
 */
export interface IntermittentCase {
  /** Identifiant court, celui qu'un rapport cite. */
  readonly id: string
  /** Chemin depuis la racine du dépôt. */
  readonly file: string
  /**
   * Un extrait qui doit se trouver dans ce fichier — le titre du cas quand il
   * en a un. C'est ce qui fait rougir la liste quand un cas est renommé, au
   * lieu de la laisser désigner un cas qui n'existe plus.
   */
  readonly witness: string
  /** Le régime sous lequel le rouge a été observé. */
  readonly regime: string
  /** La cause, écrite. « Non établie » est une réponse, l'absence n'en est pas une. */
  readonly cause: string
  /** Vrai quand une mesure l'établit, pas quand elle la rend plausible. */
  readonly established: boolean
  /** Vrai quand cette branche pose le correctif. */
  readonly corrected: boolean
  /**
   * **Le témoin du correctif**, quand il en existe un : un extrait qui doit se
   * trouver dans `file` **si et seulement si** `corrected` vaut `true`.
   *
   * Il rend la bascule de `corrected` exécutable. Sans lui, une entrée pouvait
   * rester `corrected: false` en désignant le fichier même où le correctif
   * venait d'être posé — la suite restait verte sur une entrée fausse, dans le
   * fichier dont le préambule dit « la liste est donc la source » (constat de
   * la seconde revue de s34).
   *
   * Facultatif, et ce n'est pas un assouplissement : tous les correctifs ne
   * laissent pas de trace textuelle — un délai relevé, un ordre changé. Une clé
   * obligatoire pour tous forcerait à en inventer une (P27bis).
   */
  readonly correctedWitness?: string
}

/**
 * **Le délai des fichiers qui chargent le graphe de `apps/web/next.config`**
 * (cause A).
 *
 * `vitest.config.ts` ne pose aucun `testTimeout` : le défaut est 5 000 ms, et
 * c'est exactement la valeur des expirations observées. Les fichiers de
 * `tests/` qui chargent le même graphe lourd — `next`, `@next/mdx`,
 * `next-intl/plugin`, `apps/web/lib/startup.ts` et tous les points de
 * composition — sont **dérivés** par `tests/intermittents.test.ts` depuis
 * {@link COLD_GRAPH_ENTRY_POINTS}, jamais écrits ici : la première version de
 * ce commentaire annonçait « trois fichiers » en en nommant deux, alors qu'il
 * y en avait quatre — un compte écrit à côté du code, dans le fichier construit
 * pour en finir avec les comptes écrits (constat de revue).
 *
 * **Mesuré le 05/09 sur cette branche** (8 cœurs, Vitest sur ses propres
 * travailleurs) :
 *
 * | Cas | À vide | 8 boucles de calcul en parallèle |
 * |---|---|---|
 * | `tests/deployment.test.ts`, premier import du graphe | 1 507 ms | **échec à 5 007 ms**, puis 6 875 / 7 217 / 7 576 ms délai levé |
 * | `tests/env-wiring.test.ts`, premier import du graphe | 1 875 ms | **échec à 5 007 ms**, puis 6 782 / 6 985 / 7 458 ms délai levé |
 *
 * Le rouge est donc **reproductible**, pas fortuit : à saturation du
 * processeur, les deux cas dépassent le défaut. Ce délai-ci vaut environ quatre
 * fois le pire coût mesuré — il borne un blocage, il ne surveille pas une
 * performance.
 *
 * **Posé par fichier, et c'est délibéré** : le coût tombe sur le premier cas qui
 * touche le graphe, et ce n'est pas toujours le même — l'ordre des `describe`
 * change avec le fichier. Un délai posé sur un cas nommé laisserait le suivant
 * découvert au premier déplacement de bloc.
 */
export const COLD_GRAPH_TIMEOUT_MS = 30_000

/**
 * **Ce qui tire le graphe lourd.** La liste des fichiers qui le chargent s'en
 * dérive ; elle ne s'écrit nulle part.
 */
export const COLD_GRAPH_ENTRY_POINTS = ['apps/web/next.config', 'apps/web/instrumentation'] as const

/**
 * Les appelants du graphe qui **ne** portent **pas** le délai explicite, et la
 * mesure qui le justifie.
 *
 * Un appelant est soit muni du délai, soit inscrit ici avec son chiffre :
 * `tests/intermittents.test.ts` refuse un appelant qui n'est ni l'un ni
 * l'autre, si bien qu'un cinquième force une décision au lieu d'hériter du
 * silence. Une entrée qui ne correspond plus à aucun appelant est refusée de
 * même — une exemption périmée est pire qu'absente.
 *
 * **Mesuré le 05/09 sur cette branche**, les quatre appelants joués ensemble
 * sous seize boucles de calcul, cinq passages, pire durée d'un cas :
 *
 * | Fichier | Pire durée | Décision |
 * |---|---|---|
 * | `tests/deployment.test.ts` | 7 184–7 551 ms | délai explicite |
 * | `tests/env-wiring.test.ts` | 6 925–7 465 ms | délai explicite |
 * | `tests/jobs.test.ts` | 2 318–2 499 ms | mesuré, deux fois de marge |
 * | `tests/admin.test.ts` | 634–768 ms | mesuré, six fois de marge |
 *
 * L'écart n'est pas du bruit : les deux premiers font du graphe la **première**
 * transformation d'un cas, après `vi.resetModules()`, tandis que les deux
 * autres l'ont déjà largement chargé par leurs imports statiques — le coût y est
 * payé au chargement du fichier, hors de toute assertion. Leur poser le délai
 * serait un délai élargi sans cause, ce que les critères de la story
 * interdisent.
 */
export const COLD_GRAPH_MEASURED_WITH_MARGIN: Readonly<Record<string, string>> = {
  'tests/jobs.test.ts': 'pire cas 2 318–2 499 ms sous 16 boucles, 5 passages — deux fois de marge',
  'tests/admin.test.ts': 'pire cas 634–768 ms sous 16 boucles, 5 passages — six fois de marge',
  // s39 : **faux positif du balayage, et il vaut d'être écrit**. Ce fichier ne
  // *charge* pas le graphe — il **lit** `apps/web/next.config.ts` comme du texte,
  // pour vérifier que les cartes source sont générées. Le balayage cherche une
  // sous-chaîne et ne peut pas faire la différence ; l'exempter au vu de sa
  // mesure vaut mieux que d'élargir le motif, qui rendrait le balayage aveugle
  // à un vrai appelant écrit de la même façon. Mesuré le 06/09, 3 passages :
  // pire cas 1 705 ms, soit dix-sept fois de marge.
  'tests/analytics.test.ts':
    'ne charge pas le graphe : il lit `apps/web/next.config.ts` en texte. ' +
    'Pire cas 1 705 ms sur 3 passages — dix-sept fois de marge',
}

export const INTERMITTENT_CASES: readonly IntermittentCase[] = [
  // ---- Cause A : un délai fixe contre un coût de transformation à froid ----
  {
    id: 'deployment/instrumentation',
    file: 'tests/deployment.test.ts',
    witness: 'refuse le démarrage sur une `DATABASE_URL` malformée : il sort en erreur, en la nommant',
    regime: 'suite Vitest, processeur saturé (8 boucles sur 8 cœurs)',
    cause:
      'Le défaut de 5 000 ms de Vitest contre le premier chargement du graphe de ' +
      '`apps/web/instrumentation` → `startup.ts` → tous les points de composition. ' +
      'Mesuré : 1 507 ms à vide, 6 875–7 576 ms à saturation. Corrigé par un délai de fichier, ' +
      'explicite et mesuré (COLD_GRAPH_TIMEOUT_MS).',
    established: true,
    corrected: true,
  },
  {
    id: 'env-wiring/next-config',
    file: 'tests/env-wiring.test.ts',
    witness: 'la configuration de `apps/web` charge le `.env` racine',
    regime: 'suite Vitest, processeur saturé (8 boucles sur 8 cœurs)',
    cause:
      'Même cause que `deployment/instrumentation` : le premier import de ' +
      '`apps/web/next.config` après `vi.resetModules()`. Mesuré : 1 875 ms à vide, ' +
      '6 782–7 458 ms à saturation. Même correctif.',
    established: true,
    corrected: true,
  },
  {
    id: 'audit/timeout-exterieur',
    file: 'tests/audit-exceptions.test.ts',
    witness: 'coupe un `pnpm audit` qui ne répond pas, et le traite comme une panne',
    regime: 'suite Vitest complète sous charge — 1 rouge sur 4 (relevé de s50)',
    cause:
      '**Non établie.** Le plan la rangeait avec la cause A ; la mesure ne le confirme pas. ' +
      'Écarté d’abord : un défaut de production dans `scripts/audit.ts` — `spawnSync` rend la ' +
      'main en 306 ms sur un enfant qui dort 30 s, tué par SIGTERM avec ETIMEDOUT, tuyaux ' +
      'hérités ou non. Écarté ensuite : le filet extérieur de 20 000 ms. Mesuré sur cette ' +
      'branche, le cas coûte 2 177–2 479 ms à vide (6 passages), 3 224–3 903 ms sous 64 boucles ' +
      'de calcul (6 passages), 2 443–3 077 ms sous une tempête de forks à 716 processus ' +
      '(12 passages) — et les trois tentatives sont comptées 24 fois sur 24. Le filet garde donc ' +
      'plus de cinq fois de marge à huit fois la charge nominale, et `expected 2 to be 3` n’a ' +
      'jamais été reproduit. Aucun délai n’est élargi sur une hypothèse ; ce qui est posé est ' +
      'diagnostique : quand le filet coupe, le cas le dit au lieu de rendre un compte trompeur.',
    established: false,
    corrected: false,
  },

  // ---- Cause B : une identité partagée entre deux cas ----
  {
    id: 'oauth/bouton-sans-javascript',
    file: 'e2e/oauth.spec.ts',
    witness: 'le bouton de fournisseur ouvre une session, sans JavaScript',
    regime: 'Playwright, 4 travailleurs, identité absente de la base',
    cause:
      'Les deux cas OAuth pilotaient le fournisseur local, qui rendait toujours ' +
      '`local@example.test` : joués en parallèle sur une base où la ligne n’existe pas encore, ' +
      'le perdant de la course d’insertion échoue sur `auth_user_email_key`. Reproduit sur ' +
      'cette branche au 3ᵉ passage sur 3, identité effacée entre chaque. Corrigé par une ' +
      'identité par cas.',
    established: true,
    corrected: true,
  },
  {
    id: 'oauth/retour-inter-sites',
    file: 'e2e/oauth.spec.ts',
    witness: 'le retour venu d’un autre site atterrit connecté',
    regime: 'Playwright, 4 travailleurs, identité absente de la base',
    cause:
      'Le second cas de la même course : c’est lui qui a rougi à la reproduction ' +
      '(`unable_to_create_user`, puis `/fr/sign-in?oauth=failed`). Même correctif — il prend ' +
      'désormais son propre créneau d’identité.',
    established: true,
    corrected: true,
  },
  {
    id: 'rate-limiting/leurre-de-cookie',
    file: 'e2e/rate-limiting.spec.ts',
    witness: 'la vérification 2FA reste bornée malgré un leurre de cookie posé en tête',
    regime: 'Playwright, 4 travailleurs',
    cause:
      'Même famille que la paire OAuth : deux cas tiraient leur défi de `Date.now()` seul. ' +
      'Deux travailleurs qui démarrent dans la même milliseconde produisent le **même** défi, ' +
      'donc le même seau de quatre, et les deux cas comptent les 429 de l’autre. Mesuré sur ' +
      'cette branche : écart entre les deux défis à 4 travailleurs — 3, 2, 44, 1, 42, 12, 13, ' +
      '12, 53, 26, 31, 2, 52, **0**, 22 ms sur 15 passages ; le passage à 0 ms est exactement ' +
      'celui qui a rougi, les deux cas ensemble (`[429, 429]` et `[429, 429, 429, 429]`). ' +
      'Corrigé par un identifiant unique par cas.',
    established: true,
    corrected: true,
  },
  {
    id: 'rate-limiting/defi-re-encode',
    file: 'e2e/rate-limiting.spec.ts',
    witness: 'la vérification 2FA compte le même défi ré-encodé dans le même seau',
    regime: 'Playwright, 4 travailleurs',
    cause: 'Le second cas de la collision ci-dessus, et le même correctif.',
    established: true,
    corrected: true,
  },

  // ---- Cas classés, non corrigés ----
  {
    id: 'rate-limiting/bourrage-distribue',
    file: 'e2e/rate-limiting.spec.ts',
    witness: 'la connexion est bloquée après N tentatives sur le même compte',
    regime: 'Playwright, 4 travailleurs — 1 rouge sur 11 suites (relevé de s30)',
    cause:
      '**Non établie.** Écarté par lecture : le compte visé vient de `anEmail()`, donc d’un ' +
      '`randomUUID` — il ne peut pas collisionner comme les deux cas ci-dessus ; et le seau ' +
      'd’appelant est clé par **route** (`callerBucketKey`), donc les adresses `198.51.100.x` ' +
      'que `public-forms` et `alert-contrast` tirent au hasard ne le touchent pas. Le seul ' +
      'rouge observé sur cette branche (1 sur 37 passages du fichier) rendait `[]` — aucun 429 ' +
      'du tout, pas un de trop — dans un passage où deux autres cas échouaient sur ' +
      '« element(s) not found » : le serveur ne servait pas encore. C’est une observation ' +
      'confondue, pas une cause. Ce qui est posé est diagnostique : l’échec montre désormais ' +
      'les statuts qu’il a réellement lus.',
    established: false,
    corrected: false,
  },
  {
    id: 'two-factor/region-status',
    file: 'e2e/two-factor.spec.ts',
    witness: 'activation, connexion par code, puis connexion par code de secours',
    regime: 'CI, 1 travailleur — 1 rouge sur la demande de fusion 11, jamais sur `dev`',
    cause:
      '**Non établie, et ce n’est pas un budget.** Le plan l’appelait « cause C » et attendait ' +
      'un délai. Mesuré sur cette branche, l’apparition de la région `status` après ' +
      '« Confirmer » coûte 232, 227, 198 ms à vide et 235 ms sous la suite complète avec ' +
      '8 boucles de calcul en parallèle — contre un défaut de 5 000 ms, soit 21 fois de marge. ' +
      'Élargir ce délai serait précisément le rouge rendu plus rare sans être rendu juste. ' +
      'Écarté aussi : le glissement de période TOTP — la bibliothèque vérifie sur ±1 période ' +
      '(`window = 1`, `@better-auth/utils@0.4.2/dist/otp.mjs:42,50`), et non `totpStepsToTry`, ' +
      'qui est la garde de rejeu de ce dépôt. Le cas reste ouvert et nommé.',
    established: false,
    corrected: false,
  },
  {
    id: 'blog/slug-inconnu',
    file: 'e2e/blog.spec.ts',
    witness: 'un article qui n’existe pas répond 404, sans rien annoncer',
    regime: 'Playwright — 1 rouge en revue de s53, vert au rejeu isolé',
    cause:
      '**Non établie.** `read ECONNRESET` sur un `request.get`. Même symptôme et même famille ' +
      'que `health/sonde` — deux GET simples émis par le même pool de connexions persistantes ' +
      'de Playwright — mais rien ne l’établit : aucun des deux n’a été reproduit sur cette ' +
      'branche (1 suite complète à vide, 1 sous 8 boucles de calcul, 0 rouge). Les traiter ' +
      'ensemble est une piste pour la prochaine story, pas une cause.',
    established: false,
    corrected: false,
  },
  {
    id: 'health/sonde',
    file: 'e2e/health.spec.ts',
    witness: 'la sonde de santé répond 200 avec la base connectée',
    regime: '`pnpm test:socle`, vert au second passage',
    cause: '**Non établie.** Voir `blog/slug-inconnu` : même symptôme `ECONNRESET`, non reproduit.',
    established: false,
    corrected: false,
  },
  {
    id: 'migrations/course-entre-fichiers',
    file: 'packages/db/src/migrate.ts',
    witness: 'export async function runModuleMigrations',
    regime: 'suite Vitest, 8 travailleurs — 1 rouge sur la demande de fusion 12',
    cause:
      '**Établie par lecture, corrigée en s34 (ADR 060).** `tests/auth.test.ts`, ' +
      '`tests/billing.test.ts`, `tests/organizations.test.ts` et `tests/marketing.test.ts` ' +
      'appellent chacun `runModuleMigrations` dans leur `beforeAll`, contre la **même** base, ' +
      'dans des travailleurs Vitest parallèles. Le migrateur de Drizzle est idempotent par son ' +
      'journal, pas concurrent : deux passages simultanés lisent le journal vide puis exécutent ' +
      'le même `CREATE TABLE "organization"`. s52 avait laissé la décision au plan ; s34 l’a ' +
      'rencontrée en ajoutant un quatrième module à une suite, et l’a prise — `runMigrations` ' +
      'rejoue le pas perdu contre un créateur concurrent, et **lui seul**.',
    established: true,
    corrected: true,
    correctedWitness: 'isConcurrentCreationError',
  },
  {
    id: 'auth/sessions-au-changement-d-email',
    file: 'tests/auth.test.ts',
    witness: 'révoque les autres sessions au changement d’email, une fois la nouvelle adresse confirmée',
    regime: 'inconnu — aucun relevé dans `docs/stories.md`, `docs/STATE.md`, `docs/reviews/` ni la recherche',
    cause:
      '**Non établie, et le symptôme lui-même est introuvable.** Le plan le nomme ' +
      '`tests/auth.test.ts:765`, ligne qui porte `expect(Number(rows?.count ?? -1)).toBe(0)`. ' +
      'Aucune trace du rouge dans les documents du dépôt, et 0 rouge sur les 3 exécutions ' +
      'complètes de `pnpm test` de cette branche (2 319 cas). Nommé pour que le prochain ' +
      'agent sache qu’il a été cherché, pas pour affirmer qu’il existe.',
    established: false,
    corrected: false,
  },
]
