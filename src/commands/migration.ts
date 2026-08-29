import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { ensureDir, writeGeneratedFile } from '../utils/file.utils';

export interface MigrationOptions {
  name: string;
  orm?: 'drizzle' | 'prisma';
  path?: string;
  dryRun?: boolean;
}

export interface GenerateMigrationOptions {
  module: string;
  orm?: 'drizzle' | 'prisma';
  path?: string;
  dryRun?: boolean;
}

interface ColumnDefinition {
  name: string;
  type: string;
  nullable: boolean;
  primary: boolean;
  unique: boolean;
  default?: string;
  references?: {
    table: string;
    column: string;
  };
}

interface TableDefinition {
  name: string;
  columns: ColumnDefinition[];
  indexes: Array<{ columns: string[]; unique: boolean }>;
}

export function resolveMigrationOutputPath(
  basePath: string,
  customPath: string | undefined,
  defaultPath: string,
): string {
  const projectPath = path.resolve(basePath);
  const workspacePath = findWorkspaceRoot(projectPath);
  const outputPath = customPath
    ? path.resolve(projectPath, customPath)
    : path.resolve(projectPath, defaultPath);
  const relative = path.relative(workspacePath, outputPath);

  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Migration path escapes the project workspace');
  }

  return outputPath;
}

function findWorkspaceRoot(startPath: string): string {
  let current = startPath;

  while (true) {
    if (
      fs.existsSync(path.join(current, '.git')) ||
      fs.existsSync(path.join(current, 'pnpm-workspace.yaml'))
    ) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return startPath;
    }
    current = parent;
  }
}

export async function createMigration(basePath: string, options: MigrationOptions): Promise<void> {
  const orm = options.orm || 'drizzle';
  const timestamp = Date.now();
  const migrationName = options.name.replace(/[^a-zA-Z0-9]/g, '_');

  console.log(chalk.bold.blue(`\n📦 Creating ${orm} migration: ${migrationName}\n`));

  if (orm === 'drizzle') {
    await createDrizzleMigrationStub(
      basePath,
      migrationName,
      timestamp,
      options.path,
      options.dryRun,
    );
  } else {
    await createPrismaMigration(basePath, migrationName, timestamp, options.path, options.dryRun);
  }
}

/**
 * Drizzle doesn't use hand-written TypeScript migration classes the way TypeORM
 * does. Its real workflow is: edit the `*.orm-entity.ts` `pgTable(...)` schema
 * files, then run `npx drizzle-kit generate` (which introspects the DB and the
 * schema files, described via drizzle.config.ts, to emit real SQL migrations
 * under `./drizzle`), then `npx drizzle-kit migrate` to apply them. A static
 * generator like this CLI can't safely fabricate that SQL without a live DB
 * connection, so instead of pretending to be an idiomatic Drizzle migration,
 * this scaffolds an empty, clearly-labelled SQL placeholder for one-off manual
 * changes (data backfills, extensions, views, etc.) that drizzle-kit wouldn't
 * generate on its own, and points the user at the real workflow for schema changes.
 */
async function createDrizzleMigrationStub(
  basePath: string,
  name: string,
  timestamp: number,
  customPath?: string,
  dryRun = false,
): Promise<void> {
  const migrationsPath = resolveMigrationOutputPath(basePath, customPath, 'drizzle');
  if (!dryRun) await ensureDir(migrationsPath);

  const fileName = `${timestamp}_${name}.sql`;

  const content = `-- Manual migration placeholder: ${name}
-- Created at: ${new Date(timestamp).toISOString()}
--
-- Drizzle projects generate real migrations from your *.orm-entity.ts schema
-- files with drizzle-kit, not by hand-writing migration classes. This file is
-- only a placeholder for a one-off manual SQL change (e.g. data backfill,
-- extension, view) that isn't expressed in the schema files themselves.
--
-- Recommended workflow for schema changes:
--   1. Edit the relevant *.orm-entity.ts schema file(s) under
--      src/modules/**/infrastructure/orm-entities/
--   2. Run: npx drizzle-kit generate
--   3. Run: npx drizzle-kit migrate
--
-- TODO: Add your manual SQL here.
`;

  await writeGeneratedFile(path.join(migrationsPath, fileName), content, dryRun);
  console.log(chalk.green(`✓ ${dryRun ? 'Would create' : 'Created'} migration stub: ${fileName}`));
  console.log(chalk.gray(`  Path: ${migrationsPath}`));
  console.log(chalk.yellow(`\n  Note: this is a manual placeholder, not a drizzle-kit migration.`));
  console.log(chalk.yellow(`  For schema changes, edit your *.orm-entity.ts files and run:`));
  console.log(chalk.white(`    npx drizzle-kit generate`));
  console.log(chalk.white(`    npx drizzle-kit migrate`));

  await ensureDrizzleConfig(basePath, dryRun);
}

/**
 * Make sure drizzle-kit has a config to work with. Mirrors the minimal config
 * generateDrizzleService() writes in generate-all.ts during `slade init`/`scaffold`.
 */
async function ensureDrizzleConfig(basePath: string, dryRun = false): Promise<void> {
  const drizzleConfigPath = path.join(basePath, 'drizzle.config.ts');
  if (fs.existsSync(drizzleConfigPath)) return;

  const content = `import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/modules/**/infrastructure/orm-entities/*.orm-entity.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
`;

  await writeGeneratedFile(drizzleConfigPath, content, dryRun);
  console.log(chalk.green(`✓ ${dryRun ? 'Would create' : 'Created'} drizzle.config.ts`));
}

async function createPrismaMigration(
  basePath: string,
  name: string,
  timestamp: number,
  customPath?: string,
  dryRun = false,
): Promise<void> {
  const migrationsPath = resolveMigrationOutputPath(basePath, customPath, 'prisma/migrations');
  const migrationDir = path.join(migrationsPath, `${timestamp}_${name}`);

  if (!dryRun) await ensureDir(migrationDir);

  const content = `-- Migration: ${name}
-- Created at: ${new Date(timestamp).toISOString()}

-- TODO: Add your SQL migration here
-- Examples:

-- Create table
-- CREATE TABLE "example" (
--   "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
--   "name" VARCHAR(255) NOT NULL,
--   "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
--   "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
-- );

-- Add column
-- ALTER TABLE "example" ADD COLUMN "new_column" VARCHAR(255);

-- Create index
-- CREATE INDEX "example_name_idx" ON "example"("name");

-- Add foreign key
-- ALTER TABLE "example"
--   ADD CONSTRAINT "example_user_id_fkey"
--   FOREIGN KEY ("user_id") REFERENCES "users"("id")
--   ON DELETE CASCADE;
`;

  await writeGeneratedFile(path.join(migrationDir, 'migration.sql'), content, dryRun);
  console.log(
    chalk.green(`✓ ${dryRun ? 'Would create' : 'Created'} Prisma migration: ${timestamp}_${name}`),
  );
  console.log(chalk.gray(`  Path: ${migrationDir}`));
}

export async function generateMigrationFromEntity(
  basePath: string,
  options: GenerateMigrationOptions,
): Promise<void> {
  const orm = options.orm || 'drizzle';

  if (orm === 'drizzle') {
    await guideDrizzleMigrationGeneration(basePath, options.module, options.dryRun);
    return;
  }

  const modulePath = path.join(basePath, 'src/modules', options.module);

  if (!fs.existsSync(modulePath)) {
    console.log(chalk.red(`❌ Module "${options.module}" not found.`));
    return;
  }

  console.log(chalk.bold.blue(`\n📦 Generating migration from ${options.module} entities...\n`));

  // Find entity files
  const entityFiles = findEntityFiles(modulePath);

  if (entityFiles.length === 0) {
    console.log(chalk.yellow('⚠️  No entity files found in module.'));
    return;
  }

  // Parse entities
  const tables: TableDefinition[] = [];

  for (const file of entityFiles) {
    const table = parseEntityFile(file);
    if (table) {
      tables.push(table);
    }
  }

  if (tables.length === 0) {
    console.log(chalk.yellow('⚠️  No valid entities found.'));
    return;
  }

  // Generate migration
  const timestamp = Date.now();
  const migrationName = `create_${options.module}_tables`;

  await generatePrismaMigration(
    basePath,
    tables,
    migrationName,
    timestamp,
    options.path,
    options.dryRun,
  );
}

/**
 * Drizzle can't safely fabricate a real migration from entity files without a
 * live DB connection (see createDrizzleMigrationStub for why). This command's
 * job — "derive a migration from a module's entities" — is exactly what
 * `drizzle-kit generate` does properly, by diffing your `*.orm-entity.ts`
 * schema files against the database. So for Drizzle we just point the user at
 * that workflow instead of hand-rolling a fake one.
 */
async function guideDrizzleMigrationGeneration(
  basePath: string,
  moduleName: string,
  dryRun = false,
): Promise<void> {
  const modulePath = path.join(basePath, 'src/modules', moduleName);
  const schemaGlob = `src/modules/${moduleName}/infrastructure/orm-entities/*.orm-entity.ts`;

  console.log(
    chalk.bold.blue(
      `\n📦 Drizzle migrations are generated from schema files, not scaffolded here.\n`,
    ),
  );

  if (!fs.existsSync(modulePath)) {
    console.log(chalk.yellow(`⚠️  Module "${moduleName}" not found at ${modulePath}.`));
  } else {
    console.log(chalk.cyan(`  Schema files: ${schemaGlob}`));
  }

  console.log('');
  console.log(
    chalk.white("  Drizzle can't fabricate a real migration from entity files without a"),
  );
  console.log(chalk.white('  live database connection. Instead:'));
  console.log(chalk.white(`    1. Edit/verify the *.orm-entity.ts schema file(s) for this module`));
  console.log(chalk.white(`    2. Run: npx drizzle-kit generate`));
  console.log(chalk.white(`    3. Run: npx drizzle-kit migrate`));
  console.log('');

  await ensureDrizzleConfig(basePath, dryRun);
}

function findEntityFiles(modulePath: string): string[] {
  const files: string[] = [];

  function scan(dir: string) {
    if (!fs.existsSync(dir)) return;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scan(fullPath);
      } else if (entry.name.endsWith('.entity.ts')) {
        files.push(fullPath);
      }
    }
  }

  scan(modulePath);
  return files;
}

function parseEntityFile(filePath: string): TableDefinition | null {
  const content = fs.readFileSync(filePath, 'utf-8');

  // Extract table name
  const tableMatch = content.match(/@Entity\(\s*['"]?([^'")\s]+)?['"]?\s*\)/);
  const className = content.match(/export\s+class\s+(\w+)/);

  if (!className?.[1]) return null;

  const tableName = tableMatch?.[1] || toSnakeCase(className[1].replace(/Entity$/, ''));

  const columns: ColumnDefinition[] = [];
  const indexes: Array<{ columns: string[]; unique: boolean }> = [];

  // Parse columns
  const columnRegex =
    /@(?:PrimaryGeneratedColumn|PrimaryColumn|Column|CreateDateColumn|UpdateDateColumn|DeleteDateColumn)\s*\(([^)]*)\)\s*(\w+)(?:\?)?:\s*(\w+)/g;

  let match;
  while ((match = columnRegex.exec(content)) !== null) {
    const decorator = match[0] || '';
    const options = match[1] || '';
    const propName = match[2];
    const propType = match[3];
    if (!propName || !propType) continue;

    const column: ColumnDefinition = {
      name: toSnakeCase(propName),
      type: mapTypeToSql(propType, options),
      nullable: options.includes('nullable: true') || decorator.includes('?:'),
      primary: decorator.includes('Primary'),
      unique: options.includes('unique: true'),
    };

    if (options.includes('default:')) {
      const defaultMatch = options.match(/default:\s*['"]?([^'",}]+)['"]?/);
      if (defaultMatch) {
        column.default = defaultMatch[1];
      }
    }

    columns.push(column);
  }

  // Parse relations for foreign keys
  const relationRegex =
    /@(?:ManyToOne|OneToOne)\s*\([^)]*\)\s*(?:@JoinColumn\(\s*\{[^}]*name:\s*['"](\w+)['"][^}]*\}\s*\))?\s*(\w+)/g;

  while ((match = relationRegex.exec(content)) !== null) {
    const relatedEntity = match[2];
    if (!relatedEntity) continue;
    const fkColumn = match[1] || `${toSnakeCase(relatedEntity)}_id`;

    // Add foreign key column if not already present
    if (!columns.find((c) => c.name === fkColumn)) {
      columns.push({
        name: fkColumn,
        type: 'uuid',
        nullable: true,
        primary: false,
        unique: false,
        references: {
          table: toSnakeCase(relatedEntity),
          column: 'id',
        },
      });
    }
  }

  // Parse indexes
  const indexMatch = content.match(/@Index\(\s*\[([^\]]+)\]/g);
  if (indexMatch) {
    for (const idx of indexMatch) {
      const cols = idx.match(/['"](\w+)['"]/g);
      if (cols) {
        indexes.push({
          columns: cols.map((c) => c.replace(/['"]/g, '')),
          unique: idx.includes('unique: true'),
        });
      }
    }
  }

  // Add default columns if missing
  if (!columns.find((c) => c.name === 'id')) {
    columns.unshift({
      name: 'id',
      type: 'uuid',
      nullable: false,
      primary: true,
      unique: true,
      default: 'uuid_generate_v4()',
    });
  }

  if (!columns.find((c) => c.name === 'created_at')) {
    columns.push({
      name: 'created_at',
      type: 'timestamp',
      nullable: false,
      primary: false,
      unique: false,
      default: 'CURRENT_TIMESTAMP',
    });
  }

  if (!columns.find((c) => c.name === 'updated_at')) {
    columns.push({
      name: 'updated_at',
      type: 'timestamp',
      nullable: false,
      primary: false,
      unique: false,
      default: 'CURRENT_TIMESTAMP',
    });
  }

  return { name: tableName, columns, indexes };
}

function mapTypeToSql(tsType: string, options: string): string {
  const typeMap: Record<string, string> = {
    string: 'varchar(255)',
    number: 'integer',
    boolean: 'boolean',
    Date: 'timestamp',
    bigint: 'bigint',
    float: 'float',
    decimal: 'decimal(10,2)',
  };

  // Check for explicit type in decorator options
  const explicitType = options.match(/type:\s*['"](\w+)['"]/);
  if (explicitType?.[1]) {
    return explicitType[1];
  }

  // Check for length
  const length = options.match(/length:\s*(\d+)/);
  if (length && tsType === 'string') {
    return `varchar(${length[1]})`;
  }

  return typeMap[tsType] || 'varchar(255)';
}

async function generatePrismaMigration(
  basePath: string,
  tables: TableDefinition[],
  name: string,
  timestamp: number,
  customPath?: string,
  dryRun = false,
): Promise<void> {
  const migrationsPath = resolveMigrationOutputPath(basePath, customPath, 'prisma/migrations');
  const migrationDir = path.join(migrationsPath, `${timestamp}_${name}`);

  if (!dryRun) await ensureDir(migrationDir);

  let upSql = `-- Migration: ${name}\n-- Generated at: ${new Date(timestamp).toISOString()}\n\n`;
  let downSql = `-- Rollback migration: ${name}\n\n`;

  for (const table of tables) {
    // Generate CREATE TABLE
    const columnDefs = table.columns.map((col) => {
      let def = `  "${col.name}" ${col.type.toUpperCase()}`;

      if (col.primary) {
        def += ' PRIMARY KEY';
        if (col.default) {
          def += ` DEFAULT ${col.default}`;
        }
      } else {
        if (!col.nullable) {
          def += ' NOT NULL';
        }
        if (col.unique) {
          def += ' UNIQUE';
        }
        if (col.default) {
          def += ` DEFAULT ${col.default}`;
        }
      }

      return def;
    });

    upSql += `CREATE TABLE "${table.name}" (\n${columnDefs.join(',\n')}\n);\n\n`;

    // Generate indexes
    for (const index of table.indexes) {
      const indexName = `${table.name}_${index.columns.join('_')}_idx`;
      upSql += `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX "${indexName}" ON "${table.name}"(${index.columns.map((c) => `"${c}"`).join(', ')});\n`;
    }

    // Generate foreign keys
    for (const col of table.columns.filter((c) => c.references)) {
      const fkName = `${table.name}_${col.name}_fkey`;
      upSql += `ALTER TABLE "${table.name}" ADD CONSTRAINT "${fkName}" FOREIGN KEY ("${col.name}") REFERENCES "${col.references!.table}"("${col.references!.column}") ON DELETE SET NULL;\n`;
    }

    upSql += '\n';

    // Generate DROP for down
    downSql += `DROP TABLE IF EXISTS "${table.name}" CASCADE;\n`;
  }

  await writeGeneratedFile(path.join(migrationDir, 'migration.sql'), upSql, dryRun);
  console.log(
    chalk.green(
      `✓ ${dryRun ? 'Would generate' : 'Generated'} Prisma migration: ${timestamp}_${name}`,
    ),
  );

  for (const table of tables) {
    console.log(chalk.gray(`  • Table: ${table.name} (${table.columns.length} columns)`));
  }
}

function toSnakeCase(str: string): string {
  return str
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_/, '');
}
