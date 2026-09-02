/**
 * Le chemin **interne** de l'écran de préférences.
 *
 * Il est écrit ici et nulle part ailleurs : le pied de page du site public, la
 * carte des paramètres de compte et le lien « personnaliser » de la bannière y
 * mènent tous les trois, et trois copies divergeraient. L'application le met
 * dans sa forme publique (préfixe de locale) au moment de l'afficher, et le
 * **réserve** comme identifiant public — `tests/organizations.test.ts` dérive du
 * disque les segments de premier niveau et exige que chacun le soit.
 *
 * L'écran est servi par l'application, pas par une route de module : un
 * `ModuleRoute` est un descripteur monté sous `/api/modules/…` (ADR 017), pas
 * un écran.
 */
export const CONSENT_SCREEN_PATH = '/cookies'

/** Le segment de premier niveau que cet écran réserve. */
export const CONSENT_SCREEN_SEGMENT = 'cookies'
