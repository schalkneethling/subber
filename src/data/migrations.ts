export interface MigrationDefinition {
  readonly version: number;
  readonly name: string;
}

export const MIGRATIONS = [
  { version: 1, name: "initial-storage-schema" },
] as const satisfies readonly MigrationDefinition[];

export const CURRENT_SCHEMA_VERSION = MIGRATIONS.at(-1)?.version ?? 0;

export function migrationsBetween(fromVersion: number, toVersion: number): MigrationDefinition[] {
  assertSchemaVersion(fromVersion);
  assertSchemaVersion(toVersion);

  if (fromVersion > toVersion) {
    throw new RangeError("Schema downgrades are not supported");
  }

  const migrations = MIGRATIONS.filter(
    ({ version }) => version > fromVersion && version <= toVersion,
  );

  if (migrations.length !== toVersion - fromVersion) {
    throw new Error(`Missing migration between schema versions ${fromVersion} and ${toVersion}`);
  }

  return [...migrations];
}

/**
 * Runs migrations sequentially and reports only the last successfully applied version.
 * The adapter remains responsible for wrapping these steps in its native transaction.
 */
export async function runMigrations(
  fromVersion: number,
  toVersion: number,
  apply: (migration: MigrationDefinition) => void | Promise<void>,
): Promise<number> {
  let appliedVersion = fromVersion;

  for (const migration of migrationsBetween(fromVersion, toVersion)) {
    await apply(migration);
    appliedVersion = migration.version;
  }

  return appliedVersion;
}

function assertSchemaVersion(version: number): void {
  if (!Number.isSafeInteger(version) || version < 0) {
    throw new RangeError("Schema versions must be non-negative safe integers");
  }
}
