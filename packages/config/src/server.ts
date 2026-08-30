/**
 * Surface serveur de `@repo/config`.
 *
 * Le chargement du `.env` lit le système de fichiers (`node:fs`, `node:path`).
 * Il est isolé ici, hors du barril principal : ce package est le point d'accès
 * unique à l'environnement et hébergera les variables `NEXT_PUBLIC_*`, donc un
 * composant client finira par l'importer. Depuis `@repo/config`, il n'y aura
 * alors rien de Node à traîner dans le graphe client ; ce qui charge un fichier
 * importe explicitement `@repo/config/server`.
 */
export { findRootEnvPath, loadRootEnv, type LoadRootEnvOptions } from './dotenv'
