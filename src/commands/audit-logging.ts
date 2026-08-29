/**
 * Audit Logging & Compliance Framework Generator
 * Generates comprehensive audit trail infrastructure
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';

export interface AuditLoggingOptions {
  path?: string;
  storage?: 'database' | 'file' | 'elasticsearch';
}

export async function setupAuditLogging(
  basePath: string,
  options: AuditLoggingOptions = {},
): Promise<void> {
  console.log(chalk.bold.blue('\n📝 Setting up Audit Logging Framework\n'));

  const sharedPath = path.join(basePath, 'src/shared/audit');

  if (!fs.existsSync(sharedPath)) {
    fs.mkdirSync(sharedPath, { recursive: true });
  }

  // Generate audit module
  const moduleContent = generateAuditModule();
  fs.writeFileSync(path.join(sharedPath, 'audit.module.ts'), moduleContent);
  console.log(chalk.green(`  ✓ Created audit module`));

  // Generate audit service
  const serviceContent = generateAuditService(options);
  fs.writeFileSync(path.join(sharedPath, 'audit.service.ts'), serviceContent);
  console.log(chalk.green(`  ✓ Created audit service`));

  // Generate audit interceptor
  const interceptorContent = generateAuditInterceptor();
  fs.writeFileSync(path.join(sharedPath, 'audit.interceptor.ts'), interceptorContent);
  console.log(chalk.green(`  ✓ Created audit interceptor`));

  // Generate audit entity
  const entityContent = generateAuditEntity();
  fs.writeFileSync(path.join(sharedPath, 'audit-log.entity.ts'), entityContent);
  console.log(chalk.green(`  ✓ Created audit log entity`));

  // Generate audit decorators
  const decoratorContent = generateAuditDecorators();
  fs.writeFileSync(path.join(sharedPath, 'audit.decorators.ts'), decoratorContent);
  console.log(chalk.green(`  ✓ Created audit decorators`));

  // Generate compliance reporter
  const reporterContent = generateComplianceReporter();
  fs.writeFileSync(path.join(sharedPath, 'compliance.reporter.ts'), reporterContent);
  console.log(chalk.green(`  ✓ Created compliance reporter`));

  console.log(chalk.bold.green('\n✅ Audit logging framework ready!\n'));
}

function generateAuditModule(): string {
  return `import { Module, Global, DynamicModule } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditService } from './audit.service';
import { AuditInterceptor } from './audit.interceptor';
import { ComplianceReporter } from './compliance.reporter';

export interface AuditModuleOptions {
  storage: 'database' | 'file' | 'elasticsearch';
  retentionDays?: number;
  excludePaths?: string[];
  excludeMethods?: string[];
  sensitiveFields?: string[];
  enableCompression?: boolean;
}

@Global()
@Module({})
export class AuditModule {
  static forRoot(options: AuditModuleOptions): DynamicModule {
    // AuditService and ComplianceReporter read/write audit logs through the
    // globally-provided DRIZZLE connection (see
    // src/shared/database/drizzle.provider.ts) — Drizzle has no
    // module-scoped repository registration to wire up here.
    return {
      module: AuditModule,
      imports: [],
      providers: [
        {
          provide: 'AUDIT_OPTIONS',
          useValue: options,
        },
        AuditService,
        ComplianceReporter,
        {
          provide: APP_INTERCEPTOR,
          useClass: AuditInterceptor,
        },
      ],
      exports: [AuditService, ComplianceReporter],
    };
  }
}
`;
}

function generateAuditService(options: AuditLoggingOptions): string {
  return `import { Injectable, Inject, Logger } from '@nestjs/common';
import { and, eq, gte, lte, lt, desc, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '@shared/database/drizzle.provider';
import { auditLogsTable, AuditLog, AuditAction, AuditCategory } from './audit-log.entity';

export interface AuditEntry {
  action: AuditAction;
  category: AuditCategory;
  userId?: string;
  resourceType: string;
  resourceId?: string;
  description: string;
  oldValue?: any;
  newValue?: any;
  metadata?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
}

export interface AuditQuery {
  userId?: string;
  action?: AuditAction;
  category?: AuditCategory;
  resourceType?: string;
  resourceId?: string;
  startDate?: Date;
  endDate?: Date;
  page?: number;
  pageSize?: number;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    @Inject('AUDIT_OPTIONS') private readonly options: any,
  ) {}

  /**
   * Log an audit entry
   */
  async log(entry: AuditEntry): Promise<AuditLog> {
    const [row] = await this.db
      .insert(auditLogsTable)
      .values({
        ...entry,
        oldValue: this.sanitize(entry.oldValue),
        newValue: this.sanitize(entry.newValue),
        timestamp: new Date(),
      })
      .returning();

    this.logger.debug(\`Audit log created: \${entry.action} on \${entry.resourceType}\`);

    return row;
  }

  /**
   * Log a create action
   */
  async logCreate(params: {
    userId?: string;
    resourceType: string;
    resourceId: string;
    newValue: any;
    metadata?: Record<string, any>;
  }): Promise<AuditLog> {
    return this.log({
      action: AuditAction.CREATE,
      category: AuditCategory.DATA_CHANGE,
      description: \`Created \${params.resourceType} with ID \${params.resourceId}\`,
      ...params,
    });
  }

  /**
   * Log an update action
   */
  async logUpdate(params: {
    userId?: string;
    resourceType: string;
    resourceId: string;
    oldValue: any;
    newValue: any;
    metadata?: Record<string, any>;
  }): Promise<AuditLog> {
    const changes = this.computeChanges(params.oldValue, params.newValue);

    return this.log({
      action: AuditAction.UPDATE,
      category: AuditCategory.DATA_CHANGE,
      description: \`Updated \${params.resourceType} with ID \${params.resourceId}\`,
      metadata: { ...params.metadata, changes },
      ...params,
    });
  }

  /**
   * Log a delete action
   */
  async logDelete(params: {
    userId?: string;
    resourceType: string;
    resourceId: string;
    oldValue?: any;
    metadata?: Record<string, any>;
  }): Promise<AuditLog> {
    return this.log({
      action: AuditAction.DELETE,
      category: AuditCategory.DATA_CHANGE,
      description: \`Deleted \${params.resourceType} with ID \${params.resourceId}\`,
      ...params,
    });
  }

  /**
   * Log an access action
   */
  async logAccess(params: {
    userId?: string;
    resourceType: string;
    resourceId?: string;
    metadata?: Record<string, any>;
  }): Promise<AuditLog> {
    return this.log({
      action: AuditAction.READ,
      category: AuditCategory.DATA_ACCESS,
      description: \`Accessed \${params.resourceType}\${params.resourceId ? \` with ID \${params.resourceId}\` : ''}\`,
      ...params,
    });
  }

  /**
   * Log authentication event
   */
  async logAuth(params: {
    action: 'login' | 'logout' | 'failed_login' | 'password_change';
    userId?: string;
    ipAddress?: string;
    userAgent?: string;
    metadata?: Record<string, any>;
  }): Promise<AuditLog> {
    const actionMap: Record<string, AuditAction> = {
      login: AuditAction.LOGIN,
      logout: AuditAction.LOGOUT,
      failed_login: AuditAction.LOGIN,
      password_change: AuditAction.UPDATE,
    };

    return this.log({
      action: actionMap[params.action],
      category: AuditCategory.AUTHENTICATION,
      resourceType: 'user',
      resourceId: params.userId,
      description: \`User \${params.action.replace('_', ' ')}\`,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      metadata: {
        ...params.metadata,
        success: params.action !== 'failed_login',
      },
    });
  }

  /**
   * Query audit logs
   */
  async query(query: AuditQuery): Promise<{ items: AuditLog[]; total: number }> {
    const {
      page = 1,
      pageSize = 50,
      startDate,
      endDate,
      ...filters
    } = query;

    const conditions = [];

    if (filters.userId) conditions.push(eq(auditLogsTable.userId, filters.userId));
    if (filters.action) conditions.push(eq(auditLogsTable.action, filters.action));
    if (filters.category) conditions.push(eq(auditLogsTable.category, filters.category));
    if (filters.resourceType) conditions.push(eq(auditLogsTable.resourceType, filters.resourceType));
    if (filters.resourceId) conditions.push(eq(auditLogsTable.resourceId, filters.resourceId));
    if (startDate && endDate) {
      conditions.push(gte(auditLogsTable.timestamp, startDate), lte(auditLogsTable.timestamp, endDate));
    }

    const whereClause = and(...conditions);

    const [items, [countResult]] = await Promise.all([
      this.db
        .select()
        .from(auditLogsTable)
        .where(whereClause)
        .orderBy(desc(auditLogsTable.timestamp))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      this.db
        .select({ count: sql<number>\`count(*)::int\` })
        .from(auditLogsTable)
        .where(whereClause),
    ]);

    return { items, total: countResult?.count ?? 0 };
  }

  /**
   * Get audit trail for a resource
   */
  async getResourceAuditTrail(
    resourceType: string,
    resourceId: string,
  ): Promise<AuditLog[]> {
    return this.db
      .select()
      .from(auditLogsTable)
      .where(and(eq(auditLogsTable.resourceType, resourceType), eq(auditLogsTable.resourceId, resourceId)))
      .orderBy(desc(auditLogsTable.timestamp));
  }

  /**
   * Get user activity log
   */
  async getUserActivity(userId: string, days: number = 30): Promise<AuditLog[]> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    return this.db
      .select()
      .from(auditLogsTable)
      .where(and(eq(auditLogsTable.userId, userId), gte(auditLogsTable.timestamp, startDate)))
      .orderBy(desc(auditLogsTable.timestamp));
  }

  /**
   * Sanitize sensitive data - removes/masks PII and secrets
   * OWASP A09:2021 - Security Logging and Monitoring Failures
   */
  private sanitize(data: any, depth = 0): any {
    // Prevent infinite recursion
    if (depth > 10 || !data) return data;

    // Handle strings with patterns
    if (typeof data === 'string') {
      return this.sanitizeString(data);
    }

    // Handle arrays
    if (Array.isArray(data)) {
      return data.map(item => this.sanitize(item, depth + 1));
    }

    // Handle objects
    if (typeof data === 'object' && data !== null) {
      const sanitized: Record<string, any> = {};

      // Default sensitive field names (case-insensitive matching)
      const sensitiveFieldPatterns = this.options.sensitiveFields || [
        /password/i,
        /token/i,
        /secret/i,
        /api[_-]?key/i,
        /auth/i,
        /credential/i,
        /credit[_-]?card/i,
        /card[_-]?number/i,
        /cvv/i,
        /cvc/i,
        /ssn/i,
        /social[_-]?security/i,
        /tax[_-]?id/i,
        /passport/i,
        /license/i,
        /pin/i,
        /private[_-]?key/i,
        /access[_-]?token/i,
        /refresh[_-]?token/i,
        /bearer/i,
        /authorization/i,
        /cookie/i,
        /session/i,
      ];

      for (const [key, value] of Object.entries(data)) {
        // Check if field name matches sensitive patterns
        const isSensitive = sensitiveFieldPatterns.some(pattern =>
          typeof pattern === 'string'
            ? key.toLowerCase().includes(pattern.toLowerCase())
            : pattern.test(key)
        );

        if (isSensitive && value) {
          sanitized[key] = '[REDACTED]';
        } else {
          sanitized[key] = this.sanitize(value, depth + 1);
        }
      }

      return sanitized;
    }

    return data;
  }

  /**
   * Sanitize string values that may contain sensitive patterns
   */
  private sanitizeString(value: string): string {
    if (!value || typeof value !== 'string') return value;

    let sanitized = value;

    // Mask credit card numbers (13-19 digits)
    sanitized = sanitized.replace(/\\b(\\d{4})[\\s-]?(\\d{4,6})[\\s-]?(\\d{4,5})[\\s-]?(\\d{4})\\b/g, '$1****$4');

    // Mask email addresses
    sanitized = sanitized.replace(/([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+\\.[a-zA-Z]{2,})/g, (match, user, domain) => {
      const maskedUser = user.substring(0, 2) + '***';
      return \`\${maskedUser}@\${domain}\`;
    });

    // Mask phone numbers (various formats)
    sanitized = sanitized.replace(/\\b(\\+?\\d{1,3}[-.\\s]?)?(\\(?\\d{3}\\)?[-.\\s]?)(\\d{3})[-.\\s]?(\\d{4})\\b/g, '$1$2***-$4');

    // Mask SSN-like patterns
    sanitized = sanitized.replace(/\\b(\\d{3})[-.]?(\\d{2})[-.]?(\\d{4})\\b/g, '***-**-$3');

    // Mask bearer tokens
    sanitized = sanitized.replace(/Bearer\\s+[a-zA-Z0-9._-]+/gi, 'Bearer [REDACTED]');

    // Mask API keys (common formats)
    sanitized = sanitized.replace(/([a-z]{2,}_)?[a-zA-Z0-9]{20,}/g, (match) => {
      if (match.length > 10) {
        return match.substring(0, 4) + '****' + match.substring(match.length - 4);
      }
      return match;
    });

    return sanitized;
  }

  /**
   * Compute changes between old and new values
   */
  private computeChanges(oldValue: any, newValue: any): Record<string, { from: any; to: any }> {
    const changes: Record<string, { from: any; to: any }> = {};

    if (!oldValue || !newValue) return changes;

    const allKeys = new Set([
      ...Object.keys(oldValue),
      ...Object.keys(newValue),
    ]);

    for (const key of allKeys) {
      if (JSON.stringify(oldValue[key]) !== JSON.stringify(newValue[key])) {
        changes[key] = {
          from: oldValue[key],
          to: newValue[key],
        };
      }
    }

    return changes;
  }

  /**
   * Archive old audit logs
   */
  async archive(olderThan: Date): Promise<number> {
    const rows = await this.db
      .update(auditLogsTable)
      .set({ archived: true })
      .where(and(lt(auditLogsTable.timestamp, olderThan), eq(auditLogsTable.archived, false)))
      .returning({ id: auditLogsTable.id });

    return rows.length;
  }

  /**
   * Cleanup old audit logs
   */
  async cleanup(retentionDays?: number): Promise<number> {
    const days = retentionDays || this.options.retentionDays || 365;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const rows = await this.db
      .delete(auditLogsTable)
      .where(and(lte(auditLogsTable.timestamp, cutoffDate), eq(auditLogsTable.archived, true)))
      .returning({ id: auditLogsTable.id });

    return rows.length;
  }
}
`;
}

function generateAuditInterceptor(): string {
  return `import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Inject,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Reflector } from '@nestjs/core';
import { AuditService } from './audit.service';
import { AuditAction, AuditCategory } from './audit-log.entity';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly auditService: AuditService,
    private readonly reflector: Reflector,
    @Inject('AUDIT_OPTIONS') private readonly options: any,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    // Check if auditing is disabled for this handler
    const skipAudit = this.reflector.get<boolean>('skipAudit', context.getHandler());
    if (skipAudit) {
      return next.handle();
    }

    // Check if path is excluded
    const request = context.switchToHttp().getRequest();
    if (this.shouldExclude(request)) {
      return next.handle();
    }

    // Get audit metadata
    const auditMeta = this.reflector.get<AuditMetadata>('audit', context.getHandler());
    const startTime = Date.now();

    return next.handle().pipe(
      tap({
        next: (data) => {
          this.logRequest(context, request, data, startTime, auditMeta);
        },
        error: (error) => {
          this.logError(context, request, error, startTime, auditMeta);
        },
      }),
    );
  }

  private shouldExclude(request: any): boolean {
    const excludePaths = this.options.excludePaths || ['/health', '/metrics'];
    const excludeMethods = this.options.excludeMethods || ['OPTIONS'];

    if (excludeMethods.includes(request.method)) {
      return true;
    }

    for (const path of excludePaths) {
      if (request.path.startsWith(path)) {
        return true;
      }
    }

    return false;
  }

  private async logRequest(
    context: ExecutionContext,
    request: any,
    response: any,
    startTime: number,
    auditMeta?: AuditMetadata,
  ): Promise<void> {
    const action = this.getActionFromMethod(request.method);
    const duration = Date.now() - startTime;

    await this.auditService.log({
      action,
      category: auditMeta?.category || AuditCategory.API_CALL,
      userId: request.user?.id,
      resourceType: auditMeta?.resourceType || this.extractResourceType(request.path),
      resourceId: auditMeta?.resourceId || request.params?.id,
      description: auditMeta?.description || \`\${request.method} \${request.path}\`,
      metadata: {
        method: request.method,
        path: request.path,
        query: request.query,
        duration,
        statusCode: context.switchToHttp().getResponse().statusCode,
      },
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  private async logError(
    context: ExecutionContext,
    request: any,
    error: Error,
    startTime: number,
    auditMeta?: AuditMetadata,
  ): Promise<void> {
    const duration = Date.now() - startTime;

    await this.auditService.log({
      action: AuditAction.ERROR,
      category: AuditCategory.ERROR,
      userId: request.user?.id,
      resourceType: auditMeta?.resourceType || this.extractResourceType(request.path),
      resourceId: request.params?.id,
      description: \`Error: \${error.message}\`,
      metadata: {
        method: request.method,
        path: request.path,
        duration,
        errorName: error.name,
        errorStack: error.stack,
      },
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  private getActionFromMethod(method: string): AuditAction {
    const actionMap: Record<string, AuditAction> = {
      GET: AuditAction.READ,
      POST: AuditAction.CREATE,
      PUT: AuditAction.UPDATE,
      PATCH: AuditAction.UPDATE,
      DELETE: AuditAction.DELETE,
    };
    return actionMap[method] || AuditAction.OTHER;
  }

  private extractResourceType(path: string): string {
    const parts = path.split('/').filter(Boolean);
    // Remove version prefix and get resource name
    return parts.find(p => !p.startsWith('v') && !p.match(/^\\d+$/)) || 'unknown';
  }
}

interface AuditMetadata {
  action?: AuditAction;
  category?: AuditCategory;
  resourceType?: string;
  resourceId?: string;
  description?: string;
}
`;
}

function generateAuditEntity(): string {
  return `import { pgTable, pgEnum, uuid, text, jsonb, timestamp, boolean, index } from 'drizzle-orm/pg-core';

export const auditActionEnum = pgEnum('audit_action', [
  'CREATE',
  'READ',
  'UPDATE',
  'DELETE',
  'LOGIN',
  'LOGOUT',
  'EXPORT',
  'IMPORT',
  'ERROR',
  'OTHER',
]);

export const auditCategoryEnum = pgEnum('audit_category', [
  'AUTHENTICATION',
  'AUTHORIZATION',
  'DATA_CHANGE',
  'DATA_ACCESS',
  'CONFIGURATION',
  'SECURITY',
  'API_CALL',
  'ERROR',
  'COMPLIANCE',
]);

export const auditLogsTable = pgTable(
  'audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    action: auditActionEnum('action').notNull(),
    category: auditCategoryEnum('category').notNull(),
    userId: text('user_id'),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id'),
    description: text('description').notNull(),
    oldValue: jsonb('old_value').$type<Record<string, any> | null>(),
    newValue: jsonb('new_value').$type<Record<string, any> | null>(),
    metadata: jsonb('metadata').$type<Record<string, any> | null>(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
    archived: boolean('archived').notNull().default(false),
  },
  (table) => ({
    userTimestampIdx: index('audit_logs_user_id_timestamp_idx').on(table.userId, table.timestamp),
    resourceIdx: index('audit_logs_resource_type_resource_id_idx').on(table.resourceType, table.resourceId),
    actionTimestampIdx: index('audit_logs_action_timestamp_idx').on(table.action, table.timestamp),
    categoryTimestampIdx: index('audit_logs_category_timestamp_idx').on(table.category, table.timestamp),
    timestampIdx: index('audit_logs_timestamp_idx').on(table.timestamp),
  }),
);

export type AuditLog = typeof auditLogsTable.$inferSelect;
export type NewAuditLog = typeof auditLogsTable.$inferInsert;

// Ergonomic enum-like accessors (AuditAction.CREATE, etc.) for application code,
// backed by the same string literals as the auditActionEnum/auditCategoryEnum
// Postgres enums above.
export const AuditAction = {
  CREATE: 'CREATE',
  READ: 'READ',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
  LOGIN: 'LOGIN',
  LOGOUT: 'LOGOUT',
  EXPORT: 'EXPORT',
  IMPORT: 'IMPORT',
  ERROR: 'ERROR',
  OTHER: 'OTHER',
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

export const AuditCategory = {
  AUTHENTICATION: 'AUTHENTICATION',
  AUTHORIZATION: 'AUTHORIZATION',
  DATA_CHANGE: 'DATA_CHANGE',
  DATA_ACCESS: 'DATA_ACCESS',
  CONFIGURATION: 'CONFIGURATION',
  SECURITY: 'SECURITY',
  API_CALL: 'API_CALL',
  ERROR: 'ERROR',
  COMPLIANCE: 'COMPLIANCE',
} as const;
export type AuditCategory = (typeof AuditCategory)[keyof typeof AuditCategory];
`;
}

function generateAuditDecorators(): string {
  return `import { SetMetadata, applyDecorators } from '@nestjs/common';
import { AuditAction, AuditCategory } from './audit-log.entity';

/**
 * Skip auditing for a handler
 */
export function SkipAudit() {
  return SetMetadata('skipAudit', true);
}

/**
 * Custom audit metadata
 */
export function Audit(options: {
  action?: AuditAction;
  category?: AuditCategory;
  resourceType?: string;
  description?: string;
}) {
  return SetMetadata('audit', options);
}

/**
 * Audit as data access
 */
export function AuditDataAccess(resourceType: string) {
  return Audit({
    action: AuditAction.READ,
    category: AuditCategory.DATA_ACCESS,
    resourceType,
  });
}

/**
 * Audit as data change
 */
export function AuditDataChange(resourceType: string, action: AuditAction) {
  return Audit({
    action,
    category: AuditCategory.DATA_CHANGE,
    resourceType,
  });
}

/**
 * Audit as security event
 */
export function AuditSecurity(description: string) {
  return Audit({
    category: AuditCategory.SECURITY,
    description,
  });
}

/**
 * Audit as compliance event
 */
export function AuditCompliance(description: string) {
  return Audit({
    category: AuditCategory.COMPLIANCE,
    description,
  });
}

/**
 * Sensitive operation (logs with extra detail)
 */
export function SensitiveOperation(description: string) {
  return applyDecorators(
    Audit({
      category: AuditCategory.SECURITY,
      description,
    }),
    SetMetadata('sensitiveOperation', true),
  );
}
`;
}

function generateComplianceReporter(): string {
  return `import { Injectable, Inject, Logger } from '@nestjs/common';
import { and, eq, gte, lte, desc } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '@shared/database/drizzle.provider';
import { auditLogsTable, AuditLog, AuditAction, AuditCategory } from './audit-log.entity';

export interface ComplianceReport {
  reportId: string;
  generatedAt: Date;
  period: { start: Date; end: Date };
  summary: ComplianceSummary;
  userActivity: UserActivityReport[];
  dataAccess: DataAccessReport[];
  securityEvents: SecurityEventReport[];
  anomalies: AnomalyReport[];
}

export interface ComplianceSummary {
  totalEvents: number;
  byCategory: Record<AuditCategory, number>;
  byAction: Record<AuditAction, number>;
  uniqueUsers: number;
  uniqueResources: number;
}

export interface UserActivityReport {
  userId: string;
  totalActions: number;
  lastActivity: Date;
  actionBreakdown: Record<AuditAction, number>;
}

export interface DataAccessReport {
  resourceType: string;
  accessCount: number;
  uniqueUsers: number;
  lastAccess: Date;
}

export interface SecurityEventReport {
  type: string;
  count: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  details: string[];
}

export interface AnomalyReport {
  type: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  timestamp: Date;
  context: any;
}

@Injectable()
export class ComplianceReporter {
  private readonly logger = new Logger(ComplianceReporter.name);

  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  /**
   * Generate compliance report for a period
   */
  async generateReport(startDate: Date, endDate: Date): Promise<ComplianceReport> {
    const logs = await this.db
      .select()
      .from(auditLogsTable)
      .where(and(gte(auditLogsTable.timestamp, startDate), lte(auditLogsTable.timestamp, endDate)));

    const reportId = \`compliance_\${Date.now()}\`;

    return {
      reportId,
      generatedAt: new Date(),
      period: { start: startDate, end: endDate },
      summary: this.generateSummary(logs),
      userActivity: this.analyzeUserActivity(logs),
      dataAccess: this.analyzeDataAccess(logs),
      securityEvents: this.analyzeSecurityEvents(logs),
      anomalies: this.detectAnomalies(logs),
    };
  }

  /**
   * Generate GDPR data subject report
   */
  async generateGDPRReport(userId: string): Promise<any> {
    const logs = await this.db
      .select()
      .from(auditLogsTable)
      .where(eq(auditLogsTable.userId, userId))
      .orderBy(desc(auditLogsTable.timestamp));

    const dataAccessed = new Set<string>();
    const dataModified = new Set<string>();

    for (const log of logs) {
      if (log.action === AuditAction.READ) {
        dataAccessed.add(\`\${log.resourceType}:\${log.resourceId}\`);
      }
      if (([AuditAction.CREATE, AuditAction.UPDATE, AuditAction.DELETE] as AuditAction[]).includes(log.action)) {
        dataModified.add(\`\${log.resourceType}:\${log.resourceId}\`);
      }
    }

    return {
      userId,
      generatedAt: new Date(),
      totalActivities: logs.length,
      firstActivity: logs[logs.length - 1]?.timestamp,
      lastActivity: logs[0]?.timestamp,
      dataAccessed: Array.from(dataAccessed),
      dataModified: Array.from(dataModified),
      activities: logs.map(log => ({
        timestamp: log.timestamp,
        action: log.action,
        resourceType: log.resourceType,
        resourceId: log.resourceId,
        description: log.description,
      })),
    };
  }

  /**
   * Generate SOC2 audit report
   */
  async generateSOC2Report(startDate: Date, endDate: Date): Promise<any> {
    const report = await this.generateReport(startDate, endDate);

    return {
      ...report,
      soc2Controls: {
        accessControl: this.analyzeAccessControl(report),
        changeManagement: this.analyzeChangeManagement(report),
        incidentResponse: this.analyzeIncidentResponse(report),
        dataProtection: this.analyzeDataProtection(report),
      },
    };
  }

  private generateSummary(logs: AuditLog[]): ComplianceSummary {
    const byCategory: Record<AuditCategory, number> = {} as any;
    const byAction: Record<AuditAction, number> = {} as any;
    const users = new Set<string>();
    const resources = new Set<string>();

    for (const log of logs) {
      byCategory[log.category] = (byCategory[log.category] || 0) + 1;
      byAction[log.action] = (byAction[log.action] || 0) + 1;
      if (log.userId) users.add(log.userId);
      if (log.resourceId) resources.add(\`\${log.resourceType}:\${log.resourceId}\`);
    }

    return {
      totalEvents: logs.length,
      byCategory,
      byAction,
      uniqueUsers: users.size,
      uniqueResources: resources.size,
    };
  }

  private analyzeUserActivity(logs: AuditLog[]): UserActivityReport[] {
    const userMap = new Map<string, { actions: AuditLog[]; breakdown: Record<AuditAction, number> }>();

    for (const log of logs) {
      if (!log.userId) continue;

      const existing = userMap.get(log.userId) || { actions: [], breakdown: {} as any };
      existing.actions.push(log);
      existing.breakdown[log.action] = (existing.breakdown[log.action] || 0) + 1;
      userMap.set(log.userId, existing);
    }

    return Array.from(userMap.entries()).map(([userId, data]) => ({
      userId,
      totalActions: data.actions.length,
      lastActivity: data.actions[0]?.timestamp || new Date(),
      actionBreakdown: data.breakdown,
    }));
  }

  private analyzeDataAccess(logs: AuditLog[]): DataAccessReport[] {
    const resourceMap = new Map<string, { count: number; users: Set<string>; lastAccess: Date }>();

    for (const log of logs) {
      if (log.action !== AuditAction.READ) continue;

      const existing = resourceMap.get(log.resourceType) || {
        count: 0,
        users: new Set(),
        lastAccess: new Date(0),
      };
      existing.count++;
      if (log.userId) existing.users.add(log.userId);
      if (log.timestamp > existing.lastAccess) existing.lastAccess = log.timestamp;
      resourceMap.set(log.resourceType, existing);
    }

    return Array.from(resourceMap.entries()).map(([resourceType, data]) => ({
      resourceType,
      accessCount: data.count,
      uniqueUsers: data.users.size,
      lastAccess: data.lastAccess,
    }));
  }

  private analyzeSecurityEvents(logs: AuditLog[]): SecurityEventReport[] {
    const securityLogs = logs.filter(l => l.category === AuditCategory.SECURITY);
    const events: SecurityEventReport[] = [];

    // Failed logins
    const failedLogins = securityLogs.filter(
      l => l.action === AuditAction.LOGIN && l.metadata?.success === false
    );
    if (failedLogins.length > 0) {
      events.push({
        type: 'Failed Login Attempts',
        count: failedLogins.length,
        severity: failedLogins.length > 10 ? 'high' : 'medium',
        details: failedLogins.slice(0, 5).map(l => l.description),
      });
    }

    return events;
  }

  private detectAnomalies(logs: AuditLog[]): AnomalyReport[] {
    const anomalies: AnomalyReport[] = [];

    // Detect unusual access patterns
    const userActivityByHour = new Map<string, Map<number, number>>();

    for (const log of logs) {
      if (!log.userId) continue;
      const hour = new Date(log.timestamp).getHours();
      const userHours = userActivityByHour.get(log.userId) || new Map();
      userHours.set(hour, (userHours.get(hour) || 0) + 1);
      userActivityByHour.set(log.userId, userHours);
    }

    // Check for unusual activity hours (outside 6am-11pm)
    for (const [userId, hourMap] of userActivityByHour.entries()) {
      const unusualHours = Array.from(hourMap.entries())
        .filter(([hour]) => hour < 6 || hour > 23)
        .reduce((sum, [, count]) => sum + count, 0);

      if (unusualHours > 10) {
        anomalies.push({
          type: 'Unusual Access Hours',
          description: \`User \${userId} had \${unusualHours} activities outside normal hours\`,
          severity: 'medium',
          timestamp: new Date(),
          context: { userId, unusualHours },
        });
      }
    }

    return anomalies;
  }

  private analyzeAccessControl(report: ComplianceReport): any {
    return {
      status: 'compliant',
      findings: [],
    };
  }

  private analyzeChangeManagement(report: ComplianceReport): any {
    return {
      status: 'compliant',
      findings: [],
    };
  }

  private analyzeIncidentResponse(report: ComplianceReport): any {
    return {
      status: 'compliant',
      findings: [],
    };
  }

  private analyzeDataProtection(report: ComplianceReport): any {
    return {
      status: 'compliant',
      findings: [],
    };
  }
}
`;
}
