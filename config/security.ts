/**
 * Les sources tierces de la politique de sécurité du contenu — le fichier que
 * le propriétaire édite.
 *
 * **C'est le seul endroit d'où une source peut entrer dans la politique.**
 * `docs/security.md` §1 l'exige en toutes lettres : « les sources tierces sont
 * déclarées, jamais élargies par commodité », et « ajouter une source à la
 * politique de sécurité du contenu exige une justification écrite dans la
 * story ». La règle est exécutable, pas documentaire :
 * `tests/security-headers.test.ts` découpe la politique construite et refuse
 * tout jeton qui n'est ni un mot-clé CSP (`'self'`, `'none'`, le nonce de la
 * requête) ni une ligne de ce fichier. Un domaine écrit en dur dans
 * `apps/web/lib/security-headers.ts` — le geste naturel quand on « fait
 * marcher » un script d'analyse — fait donc échouer `pnpm test`.
 *
 * Ce que ce fichier ne fait pas : décider de la **forme** de la politique. Les
 * directives, les mots-clés et la différence entre développement et production
 * appartiennent au constructeur ; ici on ne déclare que des origines.
 *
 * Les clients connus de ce fichier, et aucun n'existe encore : le captcha de
 * s28, l'analytique de s39, et le fournisseur d'identité de s12 s'il finit par
 * recevoir un formulaire plutôt qu'une redirection. Chacun devra aussi passer
 * par le registre de consentement de s36 : déclarer une origine ici l'autorise,
 * cela ne la charge pas.
 *
 * Une origine s'écrit sans barre oblique finale (`https://exemple.test`), et
 * jamais en `*` : un joker rend la politique inutile sur la directive qu'il
 * couvre.
 */
export interface ContentSecurityPolicySources {
  /** `script-src` — un script exécuté par la page. */
  readonly script: readonly string[]
  /** `style-src` — une feuille de style chargée par la page. */
  readonly style: readonly string[]
  /** `connect-src` — `fetch`, `XMLHttpRequest`, `WebSocket`, balise réseau. */
  readonly connect: readonly string[]
  /** `img-src` — une image, y compris un pixel de mesure. */
  readonly img: readonly string[]
  /** `font-src` — une police servie par un domaine externe. */
  readonly font: readonly string[]
  /** `frame-src` — un iframe intégré (widget de paiement, captcha). */
  readonly frame: readonly string[]
  /** `form-action` — la destination d'un `<form>` qui sort de l'application. */
  readonly formAction: readonly string[]
}

/**
 * L'état livré : **aucune source tierce**. Mesuré sur les onze réponses
 * balayées par `docs/research/s45-security-headers.md` §2.1 — polices et CSS
 * sont servies par l'application, les icônes sont des SVG en ligne, aucune
 * image externe. `default-src 'self'` suffit donc, sans exception.
 */
export const contentSecurityPolicySources: ContentSecurityPolicySources = {
  script: [],
  style: [],
  connect: [],
  img: [],
  font: [],
  frame: [],
  formAction: [],
}

/**
 * **Les seuils de limitation de débit** (s28, critère 4) — le second fichier que
 * le propriétaire édite, et le seul endroit où un seuil est écrit.
 *
 * Ils sont ici, dans `config/`, parce que la story l'exige en toutes lettres :
 * « les seuils sont définis dans la configuration, jamais en dur dans le code ».
 * Ils sont dans **ce** fichier-ci plutôt que dans un fichier neuf parce que la
 * limitation est de la sécurité, et que `docs/security.md` §7 la nomme au même
 * titre que la politique de sécurité du contenu.
 *
 * **Ce que ce fichier ne peut pas faire** : éteindre la limitation. Il n'existe
 * ni drapeau, ni valeur sentinelle, ni variable d'environnement pour cela
 * (critère 8) — un seuil nul ou négatif est **refusé au démarrage**, en nommant
 * la politique fautive, et non interprété comme « aucune limite ». Neutraliser
 * la limitation se fait par **injection**, dans les tests, et nulle part
 * ailleurs. Ce dépôt a payé deux fois la leçon inverse cette session :
 * `SKIP_ENV_VALIDATION` traversant un clone (s26), puis manquant de traverser
 * une image (s27). Une variable qui éteint une protection **est** une porte.
 *
 * Chaque politique porte deux seuils, et **ils ne défendent pas contre la même
 * attaque** :
 *
 * - `maxPerClient` compte par **appelant**. Il repose sur `x-forwarded-for`,
 *   c'est-à-dire sur un en-tête que l'appelant écrit lui-même : c'est une gêne
 *   contre le martèlement naïf, pas une barrière.
 * - `maxPerSubject` compte par **compte visé**, quel que soit l'appelant. C'est
 *   le seul des deux qui arrête le bourrage d'identifiants distribué — dix mille
 *   adresses, un essai chacune, sur le même compte : chaque seau d'appelant
 *   reste sous son seuil, et sans ce seau-ci le compte tombe. `null` quand la
 *   route ne vise aucun compte.
 *
 * **Pourquoi les seuils par appelant sont larges, et les seuils par compte
 * serrés.** Plusieurs personnes partagent une même adresse plus souvent qu'on
 * ne le croit : un réseau d'entreprise, un opérateur mobile, et — cas mesuré ici
 * — toute installation qu'aucun proxy de confiance ne précède, où l'application
 * ne voit qu'une seule adresse pour tout le monde. Un seuil par appelant serré
 * n'y arrête pas un attaquant, qui fait tourner l'en-tête : il ferme le produit
 * à des gens légitimes.
 *
 * **Mesuré le 3 septembre 2026** : avec `signUp.maxPerClient` à 5 par heure, la
 * suite de parcours navigateur — un seul appelant, `::1` — n'a pu inscrire que
 * cinq comptes, et **26 parcours sur 92 ont échoué** sur un 429 à l'inscription.
 * Ce n'était pas un défaut du harnais : c'était le comportement qu'aurait eu
 * toute installation sans proxy, du sixième visiteur de l'heure jusqu'au
 * dernier. Une limite qui coupe le produit est un déni de service, pas une
 * protection.
 *
 * La sécurité vit donc dans `maxPerSubject`, qui ne dépend d'aucun en-tête et
 * reste serré. `maxPerClient` borne le coût et le martèlement naïf.
 */
export interface RateLimitPolicy {
  /** Durée de la fenêtre fixe, en secondes. */
  readonly windowSeconds: number
  /** Passages tolérés par appelant et par fenêtre, celui en cours compris. */
  readonly maxPerClient: number
  /** Passages tolérés par compte visé et par fenêtre, toutes origines confondues. */
  readonly maxPerSubject: number | null
}

/**
 * Les politiques, par nom.
 *
 * `default` s'applique à **toute route publique qui n'en nomme pas d'autre** :
 * la couverture est dérivée du registre, jamais d'une liste à tenir à jour, si
 * bien qu'une route publique ajoutée demain est limitée sans que personne y
 * pense. Une route qui nomme une politique inconnue **refuse le démarrage**, en
 * nommant la route et la politique.
 *
 * Les valeurs livrées visent un produit qui démarre, pas un pic de campagne :
 * elles se remontent ici, et seulement ici.
 */
export const rateLimitPolicies = {
  /** Le filet des routes publiques qui ne demandent rien de particulier. */
  default: { windowSeconds: 60, maxPerClient: 120, maxPerSubject: null },
  /**
   * La connexion. **Le seuil qui protège est celui par compte** : vingt essais
   * par tranche de cinq minutes sur une même adresse, toutes origines
   * confondues. Un humain qui se trompe trois fois reste loin dessous ; une
   * campagne distribuée le franchit en quelques secondes, et c'est elle qu'on
   * arrête.
   *
   * Le seuil par appelant est quinze fois plus haut, parce qu'il agrège tous
   * les visiteurs d'un même réseau — un opérateur mobile, une sortie
   * d'entreprise — et **tous** les visiteurs quand aucun proxy ne renseigne
   * l'adresse. Il ne défend pas contre le bourrage distribué ; il borne le
   * martèlement naïf, à un essai par seconde soutenu.
   *
   * **Mesuré le 3 septembre 2026** : un passage complet de `pnpm test:e2e`,
   * dont toutes les requêtes viennent de `::1`, remplit ce seau à 49. À 100, deux
   * passages qui se chevauchent dans la même fenêtre de cinq minutes le
   * saturaient — c'est-à-dire que l'application se coupait elle-même.
   */
  signIn: { windowSeconds: 300, maxPerClient: 300, maxPerSubject: 20 },
  /**
   * L'inscription. Le seuil par **compte** est le vrai garde-fou : une même
   * adresse ne peut pas servir cinq fois par heure à créer un compte. Celui par
   * appelant borne le coût d'un réseau entier.
   */
  signUp: { windowSeconds: 3_600, maxPerClient: 120, maxPerSubject: 5 },
  /**
   * La réinitialisation de mot de passe : un email part à chaque passage, et
   * c'est l'**adresse visée** qu'il faut protéger du harcèlement — cinq par
   * heure, quelle que soit l'origine.
   */
  passwordReset: { windowSeconds: 3_600, maxPerClient: 120, maxPerSubject: 5 },
  /** Le magic link : idem, et c'est un lien de connexion. */
  magicLink: { windowSeconds: 3_600, maxPerClient: 120, maxPerSubject: 5 },
  /** La vérification d'un email ou d'un changement d'adresse, par jeton. */
  emailVerification: { windowSeconds: 3_600, maxPerClient: 240, maxPerSubject: null },
  /**
   * La double authentification. Six chiffres, donc un million de possibilités :
   * **c'est `maxPerSubject` qui borne l'énumération**, et il est compté sur le
   * **cookie de défi**, que le serveur a posé et signé.
   *
   * Trois rédactions ont été fausses avant celle-ci, et les trois erreurs se
   * ressemblent — elles attribuaient la garantie à ce qui ne la tenait pas :
   *
   * 1. la première la donnait au seuil **par appelant**, avec
   *    `maxPerSubject: null` : or ce seuil repose sur `x-forwarded-for`, qu'un
   *    attaquant fait tourner ;
   * 2. la deuxième lisait le cookie **par suffixe**, alors que l'en-tête
   *    `Cookie` est écrit intégralement par l'appelant et que la bibliothèque
   *    lit un **nom exact**. Un leurre posé en tête suffisait : le limiteur
   *    comptait le leurre, le serveur validait le vrai défi. Mesuré : 401×20
   *    sans un seul 429 ;
   * 3. la troisième lisait le bon **nom** mais pas la même **valeur** : le
   *    serveur lit `parsedCookies.get(nom)`, qui retire les guillemets
   *    encadrants puis décode (`better-call@1.4.0/dist/cookies.mjs:19-40`),
   *    quand le limiteur prenait la sous-chaîne brute. Le même défi, ré-encodé,
   *    ouvrait un seau neuf à chaque essai. Mesuré : quinze encodages → 401×15,
   *    la même valeur brute → 401×10 puis 429×5.
   *
   * Ce qui tient aujourd'hui, et les commandes qui échouent sinon : la lecture
   * se fait par **noms exacts** déclarés à la route, **refuse** si la requête en
   * présente plus d'un, et **normalise la valeur comme la bibliothèque** —
   * `tests/rate-limiting.test.ts` et `e2e/rate-limiting.spec.ts` posent le
   * leurre en tête et rejouent le même défi ré-encodé, et exigent le refus au
   * seuil dans les deux cas.
   *
   * **Pourquoi quatre, et pas dix.** `better-auth@1.7.2` s'impose déjà cinq
   * essais par défi sur le chemin de la connexion — `beginAttempt(5)` dans
   * `dist/plugins/two-factor/totp/index.mjs` comme dans
   * `dist/plugins/two-factor/backup-codes/index.mjs`, et
   * `dist/plugins/two-factor/verify-two-factor.mjs` **détruit le défi** au
   * cinquième. Un seuil de dix ne pouvait donc jamais mordre le premier sur un
   * défi authentique : il était écrit comme la garantie et n'était qu'un
   * décor. À quatre, ce seuil-ci mord d'abord, et le plafond de la bibliothèque
   * reste comme second filet — un défi fabriqué, que la bibliothèque refuse en
   * 401 sans jamais compter, n'est borné que par celui-ci. Quatre essais par
   * tranche de cinq minutes laissent la place à une faute de frappe.
   * `tests/rate-limiting.test.ts` dérive ce plafond de la bibliothèque
   * installée : une version qui le déplace fait rougir `pnpm test`.
   */
  twoFactor: { windowSeconds: 300, maxPerClient: 60, maxPerSubject: 4 },
  /**
   * Les passkeys : mêmes points d'entrée anonymes que la connexion.
   *
   * **Par appelant seulement**, et il faut le dire : la cérémonie WebAuthn ne
   * porte aucune cible que le serveur ait signée au moment de la limitation. Ce
   * qui protège réellement ces routes n'est donc pas ce seuil mais la
   * cryptographie de WebAuthn — une signature qu'aucun essai ne devine. Le
   * seuil borne le coût, il n'est pas la barrière.
   */
  passkey: { windowSeconds: 300, maxPerClient: 100, maxPerSubject: null },
  /**
   * L'invitation : un email part vers une adresse que l'appelant choisit. Le
   * seau par **compte visé** borne ce qu'une même adresse peut recevoir, toutes
   * organisations confondues — c'est lui qui empêche le harcèlement.
   */
  invitation: { windowSeconds: 3_600, maxPerClient: 120, maxPerSubject: 5 },
  /**
   * Les formulaires publics. Le module `marketing` garde **en plus** sa propre
   * règle, plus serrée et porteuse d'une dégradation (s11) : ce seuil-ci est le
   * plafond de la route, pas le garde-fou du formulaire.
   */
  publicForm: { windowSeconds: 600, maxPerClient: 60, maxPerSubject: null },
  // **Par appelant seulement**, et le module ajoute par-dessus un seau global
  // qui borne le coût total **sans identifiant** — c'est lui, pas ce seuil, qui
  // tient quand l'appelant fait tourner son en-tête (s11, constat F2).
  /**
   * Le téléversement : chaque passage signe une URL et réserve une clé.
   *
   * **Par appelant seulement**, et c'est suffisant ici pour une raison qui ne
   * vaut pas pour les routes publiques : ces trois routes sont
   * **authentifiées**, et le répartiteur a déjà refusé sans session. Le coût est
   * donc borné par le nombre de comptes, pas par un en-tête.
   */
  upload: { windowSeconds: 600, maxPerClient: 120, maxPerSubject: null },
  /**
   * Le checkout invité. Le module `billing` garde **en plus** sa propre règle,
   * plus serrée et porteuse d'une dégradation (s24).
   */
  guestCheckout: { windowSeconds: 600, maxPerClient: 60, maxPerSubject: null },
  // Même forme : `billing` ajoute un seau global sans identifiant, qui borne le
  // coût total quand l'en-tête tourne (s24, constat F3).
  /**
   * Les webhooks. **Large, et il faut dire pourquoi** : le fournisseur rejoue
   * en rafale après une panne, et un seuil serré transformerait sa reprise en
   * pertes d'événements. La signature, elle, est vérifiée avant tout effet — la
   * limitation n'est ici que le plafond de coût d'un flot non signé.
   *
   * **Le seau est partagé avec n'importe qui, hors proxy de confiance, et c'est
   * assumé** (constat m3 de la troisième revue). Sans relais qui écrase
   * `x-forwarded-for`, toutes les requêtes tombent dans le seau `unknown` de
   * cette route : une inondation anonyme peut donc y pousser les livraisons de
   * Stripe en 429. C'est le **seul** point d'entrée du dépôt où le seau partagé
   * touche un tiers, et la réponse est écrite plutôt que sous-entendue :
   *
   * 1. cela **dégrade** au lieu de casser — un 429 est un échec de livraison
   *    que Stripe rejoue, le `Retry-After` est honnête, la signature reste
   *    vérifiée avant tout effet, et le traitement est idempotent par
   *    identifiant d'événement ;
   * 2. la vraie réponse est **opérationnelle**, pas un seuil : derrière un
   *    proxy de confiance, le fournisseur a son propre seau
   *    (`docs/deployment.md`, section du proxy inverse) ;
   * 3. les deux réponses de code étaient pires — ne pas limiter du tout un
   *    point d'entrée public viole le socle, et vérifier la signature dans le
   *    limiteur ferait entrer le secret du fournisseur dans le chemin de la
   *    limitation, avant le gestionnaire (même refus qu'à l'ADR 051 pour le
   *    cookie de défi).
   *
   * Ce seuil est donc **le plus large de toutes les politiques**, délibérément :
   * le tiers qui ne peut pas réessayer indéfiniment ne doit jamais être le
   * premier refusé. `tests/rate-limiting.test.ts` le vérifie.
   */
  webhook: { windowSeconds: 60, maxPerClient: 600, maxPerSubject: null },
} as const satisfies Readonly<Record<string, RateLimitPolicy>>

/**
 * **Le captcha : optionnel, désactivé par défaut** (s28, critère 5).
 *
 * Désactivé, les formulaires publics restent **pleinement fonctionnels** : le
 * captcha n'est jamais une dépendance dure, et rien dans le chemin d'une
 * soumission ne le suppose présent.
 *
 * L'activer coûte une **origine tierce** dans la politique de sécurité du
 * contenu, que l'ADR 027 refuse par défaut : c'est donc un geste explicite du
 * propriétaire, qui déclare l'origine du fournisseur dans
 * `contentSecurityPolicySources` ci-dessus. L'oublier ne casse pas le formulaire
 * en silence : le démarrage **refuse**, en nommant la directive manquante.
 * Un widget bloqué par la politique aurait fermé le formulaire sans un mot.
 */
export interface CaptchaConfiguration {
  readonly enabled: boolean
  /** L'origine du fournisseur, sans barre oblique finale. Vide tant qu'il est coupé. */
  readonly origin: string | null
}

export const captcha: CaptchaConfiguration = {
  enabled: false,
  origin: null,
}
