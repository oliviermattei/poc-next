export {
  appSchema,
  composeSchema,
  enabledModuleSchemas,
  SchemaCollisionError,
  type AppSchema,
  type ComposedSchema,
  type ModuleSchema,
} from './schema'
export {
  moduleSchemaBarrelFile,
  moduleSchemaPackage,
  planModuleSchemaBarrels,
  renderModuleSchemaBarrel,
  type ModuleSchemaBarrel,
  type ModuleSchemaSource,
} from './barrel'
export {
  assertNoForbiddenModuleReferences,
  DuplicateModuleTableError,
  ForbiddenModuleReferenceError,
  type ModuleReferenceSource,
} from './references'
export {
  checkDatabaseConnection,
  closeDatabase,
  createDatabaseClient,
  getDatabase,
  type DatabaseConnection,
  type DatabaseStatus,
} from './client'
export { listDatabaseTables, type ListDatabaseTablesOptions } from './introspect'
export {
  migrationsTableFor,
  planModuleMigrations,
  runMigrations,
  runModuleMigrations,
  MIGRATIONS_SCHEMA,
  type MigratableModule,
  type MigrationsResult,
  type ModuleMigrationOutcome,
  type ModuleMigrationStep,
  type PlanModuleMigrationsOptions,
  type RunMigrationsOptions,
} from './migrate'
export { runSeeders, seeders, type RunSeedersOptions, type Seeder } from './seed'
