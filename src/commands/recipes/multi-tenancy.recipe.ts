import * as path from 'path';
import chalk from 'chalk';
import { ensureDir, writeFile } from '../../utils/file.utils';

export async function applyMultiTenancyRecipe(basePath: string) {
  const sharedPath = path.join(basePath, 'src/shared');
  const tenantPath = path.join(sharedPath, 'tenancy');

  await ensureDir(tenantPath);
  await ensureDir(path.join(tenantPath, 'middleware'));
  await ensureDir(path.join(tenantPath, 'guards'));
  await ensureDir(path.join(tenantPath, 'decorators'));

  // Tenant context
  const tenantContextContent = `import { AsyncLocalStorage } from "async_hooks";

export interface TenantContext {
  tenantId: string;
  tenantSlug?: string;
  tenantName?: string;
  config?: TenantConfig;
}

export interface TenantConfig {
  features: string[];
  limits: {
    maxUsers?: number;
    maxStorage?: number;
    [key: string]: any;
  };
  settings: Record<string, any>;
}

export const tenantStorage = new AsyncLocalStorage<TenantContext>();

/**
 * Get current tenant context
 */
export function getCurrentTenant(): TenantContext | undefined {
  return tenantStorage.getStore();
}

/**
 * Get current tenant ID
 */
export function getCurrentTenantId(): string | undefined {
  return tenantStorage.getStore()?.tenantId;
}

/**
 * Run code within tenant context
 */
export function runWithTenant<T>(tenant: TenantContext, fn: () => T): T {
  return tenantStorage.run(tenant, fn);
}

/**
 * Check if feature is enabled for current tenant
 */
export function hasFeature(feature: string): boolean {
  const tenant = getCurrentTenant();
  return tenant?.config?.features?.includes(feature) ?? false;
}
`;
  await writeFile(path.join(tenantPath, 'tenant.context.ts'), tenantContextContent);

  // Tenant middleware
  const tenantMiddlewareContent = `import { Injectable, NestMiddleware, NotFoundException } from "@nestjs/common";
import { Request, Response, NextFunction } from "express";
import { tenantStorage, TenantContext } from "../tenant.context";

export interface TenantResolver {
  resolve(req: Request): Promise<TenantContext | null>;
}

/**
 * Resolve tenant from subdomain: tenant1.example.com
 */
@Injectable()
export class SubdomainTenantResolver implements TenantResolver {
  async resolve(req: Request): Promise<TenantContext | null> {
    const host = req.hostname;
    const parts = host.split(".");

    if (parts.length < 2) return null;

    const subdomain = parts[0];
    if (subdomain === "www" || subdomain === "api") return null;

    // Look up tenant by subdomain (implement your own lookup)
    return this.lookupTenant(subdomain);
  }

  private async lookupTenant(slug: string): Promise<TenantContext | null> {
    // TODO: Implement actual tenant lookup from database
    // This is a placeholder
    return {
      tenantId: slug,
      tenantSlug: slug,
      tenantName: slug,
    };
  }
}

/**
 * Resolve tenant from header: X-Tenant-ID
 */
@Injectable()
export class HeaderTenantResolver implements TenantResolver {
  async resolve(req: Request): Promise<TenantContext | null> {
    const tenantId = req.headers["x-tenant-id"] as string;
    if (!tenantId) return null;

    return {
      tenantId,
      tenantSlug: tenantId,
    };
  }
}

/**
 * Resolve tenant from URL path: /tenant/:tenantId/...
 */
@Injectable()
export class PathTenantResolver implements TenantResolver {
  async resolve(req: Request): Promise<TenantContext | null> {
    const match = req.path.match(/^\\/tenant\\/([^/]+)/);
    if (!match) return null;

    const tenantId = match[1];
    return {
      tenantId,
      tenantSlug: tenantId,
    };
  }
}

/**
 * Resolve tenant from JWT token
 */
@Injectable()
export class JwtTenantResolver implements TenantResolver {
  async resolve(req: Request): Promise<TenantContext | null> {
    const user = (req as any).user;
    if (!user?.tenantId) return null;

    return {
      tenantId: user.tenantId,
      tenantSlug: user.tenantSlug,
    };
  }
}

/**
 * Main tenant middleware
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(private resolver: TenantResolver) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const tenant = await this.resolver.resolve(req);

    if (!tenant) {
      throw new NotFoundException("Tenant not found");
    }

    // Attach tenant to request
    (req as any).tenant = tenant;
    (req as any).tenantId = tenant.tenantId;

    // Run remaining middleware in tenant context
    tenantStorage.run(tenant, () => next());
  }
}
`;
  await writeFile(
    path.join(tenantPath, 'middleware/tenant.middleware.ts'),
    tenantMiddlewareContent,
  );

  // Tenant guard
  const tenantGuardContent = `import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { getCurrentTenant, hasFeature } from "../tenant.context";

export const TENANT_FEATURE_KEY = "tenant_feature";
export const RequireFeature = (...features: string[]) =>
  Reflect.metadata(TENANT_FEATURE_KEY, features);

@Injectable()
export class TenantFeatureGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredFeatures = this.reflector.getAllAndOverride<string[]>(
      TENANT_FEATURE_KEY,
      [context.getHandler(), context.getClass()]
    );

    if (!requiredFeatures || requiredFeatures.length === 0) {
      return true;
    }

    const tenant = getCurrentTenant();
    if (!tenant) {
      throw new ForbiddenException("No tenant context");
    }

    for (const feature of requiredFeatures) {
      if (!hasFeature(feature)) {
        throw new ForbiddenException(
          \`Feature '\${feature}' is not enabled for this tenant\`
        );
      }
    }

    return true;
  }
}

@Injectable()
export class TenantIsolationGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const tenant = getCurrentTenant();
    const user = request.user;

    if (!tenant) {
      throw new ForbiddenException("No tenant context");
    }

    // Ensure user belongs to current tenant
    if (user && user.tenantId !== tenant.tenantId) {
      throw new ForbiddenException("Access denied: tenant mismatch");
    }

    return true;
  }
}
`;
  await writeFile(path.join(tenantPath, 'guards/tenant.guard.ts'), tenantGuardContent);

  // Tenant-aware repository
  const tenantRepositoryContent = `import { and, eq, count, type SQL } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { DrizzleDb } from "@shared/database/drizzle.provider";
import { getCurrentTenantId } from "./tenant.context";

/**
 * Base interface for tenant-aware entities
 */
export interface TenantEntity {
  id: string;
  tenantId: string;
}

/**
 * Tenant-aware repository that automatically scopes every query by the
 * current tenant. Extend it with the table and the \`id\`/\`tenantId\` columns
 * for your entity, e.g.:
 *
 *   class UsersRepository extends TenantAwareRepository<UserRow> {
 *     constructor(@Inject(DRIZZLE) db: DrizzleDb) {
 *       super(db, usersTable, usersTable.id, usersTable.tenantId);
 *     }
 *   }
 */
export class TenantAwareRepository<T extends TenantEntity> {
  constructor(
    protected readonly db: DrizzleDb,
    protected readonly table: PgTable,
    protected readonly idColumn: AnyPgColumn,
    protected readonly tenantIdColumn: AnyPgColumn
  ) {}

  /**
   * Get current tenant ID or throw
   */
  protected getTenantId(): string {
    const tenantId = getCurrentTenantId();
    if (!tenantId) {
      throw new Error("No tenant context available");
    }
    return tenantId;
  }

  /**
   * Build a WHERE condition scoped to the current tenant, optionally
   * combined with extra conditions (e.g. an id lookup).
   */
  protected tenantScoped(...extra: (SQL | undefined)[]): SQL {
    const conditions = [eq(this.tenantIdColumn, this.getTenantId()), ...extra].filter(
      (condition): condition is SQL => Boolean(condition)
    );
    return and(...conditions)!;
  }

  /**
   * Find all entities for current tenant
   */
  async findAll(): Promise<T[]> {
    const rows = await this.db.select().from(this.table).where(this.tenantScoped());
    return rows as unknown as T[];
  }

  /**
   * Find one entity by ID for current tenant
   */
  async findById(id: string): Promise<T | null> {
    const [row] = await this.db
      .select()
      .from(this.table)
      .where(this.tenantScoped(eq(this.idColumn, id)))
      .limit(1);
    return (row as unknown as T) ?? null;
  }

  /**
   * Create entity with tenant ID
   */
  async create(data: Partial<T>): Promise<T> {
    const [row] = await this.db
      .insert(this.table)
      .values({ ...data, tenantId: this.getTenantId() } as any)
      .returning();
    return row as unknown as T;
  }

  /**
   * Update entity ensuring tenant isolation
   */
  async update(id: string, data: Partial<T>): Promise<T | null> {
    const existing = await this.findById(id);
    if (!existing) return null;

    await this.db
      .update(this.table)
      .set(data as any)
      .where(this.tenantScoped(eq(this.idColumn, id)));

    return this.findById(id);
  }

  /**
   * Delete entity ensuring tenant isolation
   */
  async delete(id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(this.table)
      .where(this.tenantScoped(eq(this.idColumn, id)))
      .returning({ id: this.idColumn });
    return deleted.length > 0;
  }

  /**
   * Count entities for current tenant
   */
  async count(): Promise<number> {
    const [result] = await this.db
      .select({ value: count() })
      .from(this.table)
      .where(this.tenantScoped());
    return result?.value ?? 0;
  }
}
`;
  await writeFile(path.join(tenantPath, 'tenant-aware.repository.ts'), tenantRepositoryContent);

  // Tenant decorator
  const tenantDecoratorContent = `import { createParamDecorator, ExecutionContext, SetMetadata } from "@nestjs/common";
import { getCurrentTenant, TenantContext } from "../tenant.context";

/**
 * Get current tenant from request
 */
export const CurrentTenant = createParamDecorator(
  (data: keyof TenantContext | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const tenant = request.tenant || getCurrentTenant();

    if (!tenant) return null;
    return data ? tenant[data] : tenant;
  }
);

/**
 * Get current tenant ID
 */
export const TenantId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.tenantId || getCurrentTenant()?.tenantId;
  }
);

/**
 * Mark endpoint as requiring specific tenant features
 */
export const TENANT_FEATURES = "tenant:features";
export const RequireTenantFeatures = (...features: string[]) =>
  SetMetadata(TENANT_FEATURES, features);

/**
 * Mark endpoint as tenant-isolated
 */
export const TENANT_ISOLATED = "tenant:isolated";
export const TenantIsolated = () => SetMetadata(TENANT_ISOLATED, true);
`;
  await writeFile(path.join(tenantPath, 'decorators/tenant.decorator.ts'), tenantDecoratorContent);

  // Tenant module
  const tenantModuleContent = `import { Module, Global, DynamicModule, MiddlewareConsumer, NestModule } from "@nestjs/common";
import {
  TenantMiddleware,
  SubdomainTenantResolver,
  HeaderTenantResolver,
  PathTenantResolver,
  TenantResolver,
} from "./middleware/tenant.middleware";
import { TenantFeatureGuard, TenantIsolationGuard } from "./guards/tenant.guard";

export type TenantStrategy = "subdomain" | "header" | "path" | "jwt";

export interface TenantModuleOptions {
  strategy: TenantStrategy;
  excludePaths?: string[];
}

@Global()
@Module({})
export class TenantModule implements NestModule {
  static options: TenantModuleOptions;

  static forRoot(options: TenantModuleOptions): DynamicModule {
    TenantModule.options = options;

    const resolverProvider = {
      provide: TenantResolver,
      useClass: this.getResolverClass(options.strategy),
    };

    return {
      module: TenantModule,
      providers: [
        resolverProvider,
        TenantMiddleware,
        TenantFeatureGuard,
        TenantIsolationGuard,
      ],
      exports: [
        TenantMiddleware,
        TenantFeatureGuard,
        TenantIsolationGuard,
      ],
    };
  }

  private static getResolverClass(strategy: TenantStrategy) {
    switch (strategy) {
      case "subdomain":
        return SubdomainTenantResolver;
      case "header":
        return HeaderTenantResolver;
      case "path":
        return PathTenantResolver;
      default:
        return HeaderTenantResolver;
    }
  }

  configure(consumer: MiddlewareConsumer) {
    const excludePaths = TenantModule.options?.excludePaths || [
      "/health",
      "/docs",
      "/swagger",
    ];

    consumer
      .apply(TenantMiddleware)
      .exclude(...excludePaths)
      .forRoutes("*");
  }
}
`;
  await writeFile(path.join(tenantPath, 'tenant.module.ts'), tenantModuleContent);

  // Index exports
  await writeFile(
    path.join(tenantPath, 'index.ts'),
    `export * from "./tenant.context";
export * from "./tenant-aware.repository";
export * from "./tenant.module";
export * from "./middleware/tenant.middleware";
export * from "./guards/tenant.guard";
export * from "./decorators/tenant.decorator";
`,
  );

  await writeFile(
    path.join(tenantPath, 'middleware/index.ts'),
    `export * from "./tenant.middleware";
`,
  );

  await writeFile(
    path.join(tenantPath, 'guards/index.ts'),
    `export * from "./tenant.guard";
`,
  );

  await writeFile(
    path.join(tenantPath, 'decorators/index.ts'),
    `export * from "./tenant.decorator";
`,
  );

  console.log(chalk.green('  ✓ Tenant context with AsyncLocalStorage'));
  console.log(chalk.green('  ✓ Multiple tenant resolvers (subdomain, header, path, JWT)'));
  console.log(chalk.green('  ✓ Tenant middleware'));
  console.log(chalk.green('  ✓ Tenant feature guard'));
  console.log(chalk.green('  ✓ Tenant isolation guard'));
  console.log(chalk.green('  ✓ Tenant-aware repository base class'));
  console.log(chalk.green('  ✓ Tenant decorators (@CurrentTenant, @TenantId)'));
  console.log(chalk.green('  ✓ Tenant module with strategy selection'));
}
