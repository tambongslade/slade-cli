import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { ensureDir, writeFile } from '../utils/file.utils';

export interface MultiDatabaseOptions {
  path?: string;
  databases?: string[];
}

interface DatabaseConfig {
  name: string;
  type: 'postgres';
  connectionName: string;
  entities: string[];
}

export async function setupMultiDatabase(
  basePath: string,
  options: MultiDatabaseOptions = {},
): Promise<void> {
  console.log(chalk.bold.blue('\n🗄️  Setting up Multi-Database Support\n'));

  const sharedPath = path.join(basePath, 'src/shared');
  const dbPath = path.join(sharedPath, 'database');

  await ensureDir(dbPath);
  await ensureDir(path.join(dbPath, 'connections'));
  await ensureDir(path.join(dbPath, 'repositories'));

  // Database configuration types
  const typesContent = `/**
 * Drizzle multi-database support targets Postgres connections only, each
 * backed by its own \`postgres\`-js client wrapped in \`drizzle()\`.
 */
export interface DatabaseConnectionConfig {
  name: string;
  type: 'postgres';
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  database?: string;
  url?: string;
  ssl?: boolean;
  maxConnections?: number;
  logging?: boolean;
}

export interface MultiDatabaseConfig {
  default: string;
  connections: Record<string, DatabaseConnectionConfig>;
}

export type ConnectionName = string;

export interface DatabaseHealthStatus {
  name: string;
  connected: boolean;
  latency?: number;
  error?: string;
}
`;
  await writeFile(path.join(dbPath, 'database.types.ts'), typesContent);
  console.log(chalk.green('  ✓ Database types'));

  // Connection manager
  const connectionManagerContent = `import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';
import { DatabaseConnectionConfig, DatabaseHealthStatus } from '../database.types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ConnectionDb = PostgresJsDatabase<Record<string, any>>;

interface ManagedConnection {
  client: Sql;
  db: ConnectionDb;
}

@Injectable()
export class ConnectionManager implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConnectionManager.name);
  private connections: Map<string, ManagedConnection> = new Map();
  private defaultConnection: string = 'default';

  async onModuleInit() {
    // Connections are lazy-loaded via registerConnection()
    this.logger.log('ConnectionManager initialized');
  }

  async onModuleDestroy() {
    await this.closeAll();
  }

  /**
   * Get an already-registered connection's Drizzle client
   */
  async getConnection(name: string = 'default'): Promise<ConnectionDb> {
    const conn = this.connections.get(name);
    if (conn) {
      return conn.db;
    }

    throw new Error(\`Connection "\${name}" not found. Register it first.\`);
  }

  /**
   * Register a new Postgres connection (a \`postgres\`-js client wrapped by \`drizzle()\`)
   */
  async registerConnection(config: DatabaseConnectionConfig): Promise<ConnectionDb> {
    const existing = this.connections.get(config.name);
    if (existing) {
      return existing.db;
    }

    const client = this.buildClient(config);
    const db: ConnectionDb = drizzle(client);
    this.connections.set(config.name, { client, db });

    this.logger.log(\`Connected to database: \${config.name} (postgres)\`);
    return db;
  }

  /**
   * Close a specific connection
   */
  async closeConnection(name: string): Promise<void> {
    const conn = this.connections.get(name);
    if (conn) {
      await conn.client.end();
      this.connections.delete(name);
      this.logger.log(\`Closed connection: \${name}\`);
    }
  }

  /**
   * Close all connections
   */
  async closeAll(): Promise<void> {
    for (const [name, conn] of this.connections) {
      await conn.client.end();
      this.logger.log(\`Closed connection: \${name}\`);
    }
    this.connections.clear();
  }

  /**
   * Check health of all connections
   */
  async healthCheck(): Promise<DatabaseHealthStatus[]> {
    const statuses: DatabaseHealthStatus[] = [];

    for (const [name, conn] of this.connections) {
      const status: DatabaseHealthStatus = { name, connected: false };

      try {
        const start = Date.now();
        await conn.db.execute(sql\`select 1\`);
        status.connected = true;
        status.latency = Date.now() - start;
      } catch (error) {
        status.error = (error as Error).message;
      }

      statuses.push(status);
    }

    return statuses;
  }

  /**
   * Get list of registered connections
   */
  getConnectionNames(): string[] {
    return Array.from(this.connections.keys());
  }

  /**
   * Set default connection
   */
  setDefaultConnection(name: string): void {
    if (!this.connections.has(name)) {
      throw new Error(\`Connection "\${name}" not found\`);
    }
    this.defaultConnection = name;
  }

  private buildClient(config: DatabaseConnectionConfig): Sql {
    const connectionString =
      config.url ||
      \`postgres://\${config.username}:\${config.password}@\${config.host || 'localhost'}:\${config.port || 5432}/\${config.database}\`;

    return postgres(connectionString, {
      max: config.maxConnections ?? 10,
      ssl: config.ssl ?? false,
      debug: config.logging ?? false,
    });
  }
}
`;
  await writeFile(path.join(dbPath, 'connections/connection-manager.ts'), connectionManagerContent);
  console.log(chalk.green('  ✓ Connection manager'));

  // Multi-database repository base
  const multiRepoContent = `import { eq } from 'drizzle-orm';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { ConnectionManager, type ConnectionDb } from '../connections/connection-manager';

/**
 * Base repository that can work with multiple named Postgres connections.
 * \`table\` must be a Drizzle \`pgTable(...)\` definition with an \`id\` column
 * (see \`infrastructure/orm-entities/*.orm-entity.ts\` for the schema shape).
 */
export abstract class MultiDatabaseRepository<TTable extends PgTable & { id: any }> {
  protected connectionManager: ConnectionManager;
  protected table: TTable;
  protected connectionName: string;

  constructor(
    connectionManager: ConnectionManager,
    table: TTable,
    connectionName: string = 'default'
  ) {
    this.connectionManager = connectionManager;
    this.table = table;
    this.connectionName = connectionName;
  }

  /**
   * Get the Drizzle client for the current connection
   */
  protected async getDb(): Promise<ConnectionDb> {
    return this.connectionManager.getConnection(this.connectionName);
  }

  /**
   * Switch to a different connection
   */
  useConnection(connectionName: string): this {
    this.connectionName = connectionName;
    return this;
  }

  /**
   * Execute within a transaction on the current connection
   */
  async withTransaction<R>(work: (tx: ConnectionDb) => Promise<R>): Promise<R> {
    const db = await this.getDb();
    return db.transaction((tx) => work(tx as unknown as ConnectionDb));
  }

  // Standard CRUD operations
  async findAll(): Promise<InferSelectModel<TTable>[]> {
    const db = await this.getDb();
    const rows = await db.select().from(this.table as any);
    return rows as InferSelectModel<TTable>[];
  }

  async findById(id: string | number): Promise<InferSelectModel<TTable> | null> {
    const db = await this.getDb();
    const [row] = await db
      .select()
      .from(this.table as any)
      .where(eq((this.table as any).id, id));
    return (row as InferSelectModel<TTable>) ?? null;
  }

  async create(data: InferInsertModel<TTable>): Promise<InferSelectModel<TTable>> {
    const db = await this.getDb();
    const [row] = await db
      .insert(this.table as any)
      .values(data as any)
      .returning();
    return row as InferSelectModel<TTable>;
  }

  async update(
    id: string | number,
    data: Partial<InferInsertModel<TTable>>,
  ): Promise<InferSelectModel<TTable> | null> {
    const db = await this.getDb();
    const [row] = await db
      .update(this.table as any)
      .set(data as any)
      .where(eq((this.table as any).id, id))
      .returning();
    return (row as InferSelectModel<TTable>) ?? null;
  }

  async delete(id: string | number): Promise<void> {
    const db = await this.getDb();
    await db.delete(this.table as any).where(eq((this.table as any).id, id));
  }
}
`;
  await writeFile(path.join(dbPath, 'repositories/multi-database.repository.ts'), multiRepoContent);
  console.log(chalk.green('  ✓ Multi-database repository base'));

  // Database decorator
  const decoratorContent = `import { Inject } from '@nestjs/common';

export const CONNECTION_NAME = 'DATABASE_CONNECTION_NAME';

/**
 * Decorator to specify which database connection to use
 */
export function UseConnection(connectionName: string): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata(CONNECTION_NAME, connectionName, target);
  };
}

/**
 * Decorator to inject a specific database connection
 */
export function InjectConnection(connectionName: string = 'default') {
  return Inject(\`DATABASE_CONNECTION_\${connectionName.toUpperCase()}\`);
}
`;
  await writeFile(path.join(dbPath, 'decorators.ts'), decoratorContent);
  console.log(chalk.green('  ✓ Database decorators'));

  // Database module
  const moduleContent = `import { Module, Global, DynamicModule } from '@nestjs/common';
import { ConnectionManager } from './connections/connection-manager';
import { MultiDatabaseConfig, DatabaseConnectionConfig } from './database.types';

@Global()
@Module({})
export class MultiDatabaseModule {
  static forRoot(config: MultiDatabaseConfig): DynamicModule {
    const connectionProviders = Object.entries(config.connections).map(([name, connConfig]) => ({
      provide: \`DATABASE_CONNECTION_\${name.toUpperCase()}\`,
      useFactory: async (manager: ConnectionManager) => {
        return manager.registerConnection({ ...connConfig, name });
      },
      inject: [ConnectionManager],
    }));

    return {
      module: MultiDatabaseModule,
      providers: [
        ConnectionManager,
        ...connectionProviders,
        {
          provide: 'MULTI_DATABASE_CONFIG',
          useValue: config,
        },
      ],
      exports: [ConnectionManager, ...connectionProviders.map(p => p.provide)],
    };
  }

  static forFeature(connectionName: string = 'default'): DynamicModule {
    return {
      module: MultiDatabaseModule,
      providers: [
        {
          provide: 'CURRENT_CONNECTION',
          useFactory: (manager: ConnectionManager) => manager.getConnection(connectionName),
          inject: [ConnectionManager],
        },
      ],
      exports: ['CURRENT_CONNECTION'],
    };
  }
}
`;
  await writeFile(path.join(dbPath, 'multi-database.module.ts'), moduleContent);
  console.log(chalk.green('  ✓ Multi-database module'));

  // Index exports
  await writeFile(
    path.join(dbPath, 'index.ts'),
    `export * from './database.types';
export * from './connections/connection-manager';
export * from './repositories/multi-database.repository';
export * from './decorators';
export * from './multi-database.module';
`,
  );

  await writeFile(
    path.join(dbPath, 'connections/index.ts'),
    `export * from './connection-manager';
`,
  );

  await writeFile(
    path.join(dbPath, 'repositories/index.ts'),
    `export * from './multi-database.repository';
`,
  );

  console.log(chalk.green('\n✅ Multi-database support configured!'));
  console.log(chalk.gray('\nUsage example:'));
  console.log(
    chalk.cyan(`
  // In app.module.ts
  MultiDatabaseModule.forRoot({
    default: 'primary',
    connections: {
      primary: { type: 'postgres', host: 'localhost', database: 'app', ... },
      analytics: { type: 'postgres', host: 'analytics-db', database: 'analytics', ... },
      reporting: { type: 'postgres', url: 'postgres://...', ... },
    },
  })
  `),
  );
}
