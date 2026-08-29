/**
 * Abstract Repository Pattern Generator
 * Generates type-safe repository interfaces and implementations
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { getModulePath } from '../utils/file.utils';
import { toCamelCase, toKebabCase, toPascalCase } from '../utils/naming.utils';

export interface RepositoryOptions {
  path?: string;
  module?: string;
  orm?: 'drizzle' | 'prisma';
}

export async function generateRepository(
  entityName: string,
  basePath: string,
  options: RepositoryOptions = {},
): Promise<void> {
  console.log(chalk.bold.blue('\n📦 Generating Repository Pattern\n'));

  const moduleName = options.module || 'shared';
  const orm = options.orm || 'drizzle';
  const repoPath = path.join(getModulePath(basePath, moduleName), 'infrastructure', 'repositories');

  if (!fs.existsSync(repoPath)) {
    fs.mkdirSync(repoPath, { recursive: true });
  }

  // Generate repository interface
  const interfaceContent = generateRepositoryInterface(entityName);
  const interfaceFile = path.join(repoPath, `${toKebabCase(entityName)}.repository.interface.ts`);
  fs.writeFileSync(interfaceFile, interfaceContent);
  console.log(chalk.green(`  ✓ Created ${interfaceFile}`));

  // Generate implementation
  const implContent =
    orm === 'prisma' ? generatePrismaRepository(entityName) : generateDrizzleRepository(entityName);
  const implFile = path.join(repoPath, `${toKebabCase(entityName)}.repository.ts`);
  fs.writeFileSync(implFile, implContent);
  console.log(chalk.green(`  ✓ Created ${implFile}`));

  console.log(chalk.bold.green('\n✅ Repository generated successfully!\n'));
}

function generateRepositoryInterface(entityName: string): string {
  const className = toPascalCase(entityName);

  return `import { ${className} } from '@domain/${toKebabCase(entityName)}.entity';
import { Specification } from '@shared/specifications/specification';

/**
 * ${className} Repository Interface
 * Defines the contract for ${className} persistence operations
 */
export interface I${className}Repository {
  /**
   * Find entity by ID
   */
  findById(id: string): Promise<${className} | null>;

  /**
   * Find all entities
   */
  findAll(): Promise<${className}[]>;

  /**
   * Find entities matching specification
   */
  findBySpec(spec: Specification<${className}>): Promise<${className}[]>;

  /**
   * Find one entity matching specification
   */
  findOneBySpec(spec: Specification<${className}>): Promise<${className} | null>;

  /**
   * Count entities matching specification
   */
  countBySpec(spec: Specification<${className}>): Promise<number>;

  /**
   * Check if any entity matches specification
   */
  exists(spec: Specification<${className}>): Promise<boolean>;

  /**
   * Save entity (create or update)
   */
  save(entity: ${className}): Promise<${className}>;

  /**
   * Save multiple entities
   */
  saveMany(entities: ${className}[]): Promise<${className}[]>;

  /**
   * Delete entity by ID
   */
  delete(id: string): Promise<void>;

  /**
   * Delete entities matching specification
   */
  deleteBySpec(spec: Specification<${className}>): Promise<number>;

  /**
   * Perform operation in transaction
   */
  transaction<T>(operation: (repo: I${className}Repository) => Promise<T>): Promise<T>;
}

/**
 * Repository query options
 */
export interface QueryOptions<T> {
  where?: Partial<T>;
  orderBy?: { field: keyof T; direction: 'ASC' | 'DESC' }[];
  skip?: number;
  take?: number;
  relations?: string[];
}

/**
 * Paginated result
 */
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}
`;
}

function generateDrizzleRepository(entityName: string): string {
  const className = toPascalCase(entityName);
  const varName = toCamelCase(entityName);
  const kebabName = toKebabCase(entityName);

  return `import { Injectable, Inject } from '@nestjs/common';
import { eq, and, inArray, count, type SQL } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '@shared/database/drizzle.provider';
import { ${varName}Table } from '@domain/${kebabName}.schema';
import { ${className} } from '@domain/${kebabName}.entity';
import { I${className}Repository, QueryOptions, PaginatedResult } from './${kebabName}.repository.interface';
import { Specification } from '@shared/specifications/specification';

/**
 * Drizzle (Postgres) implementation of ${className} Repository
 */
@Injectable()
export class ${className}Repository implements I${className}Repository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async findById(id: string): Promise<${className} | null> {
    const [row] = await this.db.select().from(${varName}Table).where(eq(${varName}Table.id, id)).limit(1);
    return row ? this.toDomain(row) : null;
  }

  async findAll(): Promise<${className}[]> {
    const rows = await this.db.select().from(${varName}Table);
    return rows.map((r) => this.toDomain(r));
  }

  async findBySpec(spec: Specification<${className}>): Promise<${className}[]> {
    const where = this.specToWhere(spec);
    const rows = where
      ? await this.db.select().from(${varName}Table).where(where)
      : await this.db.select().from(${varName}Table);
    return rows.map((r) => this.toDomain(r));
  }

  async findOneBySpec(spec: Specification<${className}>): Promise<${className} | null> {
    const results = await this.findBySpec(spec);
    return results[0] || null;
  }

  async countBySpec(spec: Specification<${className}>): Promise<number> {
    const where = this.specToWhere(spec);
    const query = this.db.select({ value: count() }).from(${varName}Table);
    const [result] = where ? await query.where(where) : await query;
    return result?.value ?? 0;
  }

  async exists(spec: Specification<${className}>): Promise<boolean> {
    const total = await this.countBySpec(spec);
    return total > 0;
  }

  async save(entity: ${className}): Promise<${className}> {
    const data = this.toRow(entity);
    const [row] = await this.db
      .insert(${varName}Table)
      .values(data)
      .onConflictDoUpdate({ target: ${varName}Table.id, set: data })
      .returning();
    return this.toDomain(row);
  }

  async saveMany(entities: ${className}[]): Promise<${className}[]> {
    return Promise.all(entities.map((entity) => this.save(entity)));
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(${varName}Table).where(eq(${varName}Table.id, id));
  }

  async deleteBySpec(spec: Specification<${className}>): Promise<number> {
    const entities = await this.findBySpec(spec);
    if (entities.length === 0) return 0;

    await this.db.delete(${varName}Table).where(inArray(${varName}Table.id, entities.map((e) => e.id!)));
    return entities.length;
  }

  async transaction<T>(operation: (repo: I${className}Repository) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      const transactionalRepo = new Transactional${className}Repository(tx as unknown as DrizzleDb);
      return operation(transactionalRepo);
    });
  }

  /**
   * Find with pagination
   */
  async findPaginated(
    options: QueryOptions<${className}>,
    page: number = 1,
    pageSize: number = 10,
  ): Promise<PaginatedResult<${className}>> {
    const conditions: SQL[] = Object.entries(options.where || {}).map(([key, value]) =>
      eq((${varName}Table as any)[key], value),
    );
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const rowsQuery = this.db.select().from(${varName}Table);
    const countQuery = this.db.select({ value: count() }).from(${varName}Table);

    const [items, [totalResult]] = await Promise.all([
      (where ? rowsQuery.where(where) : rowsQuery)
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      where ? countQuery.where(where) : countQuery,
    ]);

    const total = totalResult?.value ?? 0;
    const totalPages = Math.ceil(total / pageSize);

    return {
      items: items.map((i) => this.toDomain(i)),
      total,
      page,
      pageSize,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    };
  }

  private toDomain(row: any): ${className} {
    // Map a Drizzle row to the domain entity
    return new ${className}(row);
  }

  private toRow(entity: ${className}): any {
    // Map the domain entity to a Drizzle insert/update row
    return { ...entity };
  }

  private specToWhere(_spec: Specification<${className}>): SQL | undefined {
    // TODO: implement a DrizzleSpecVisitor that walks the specification tree and
    // builds drizzle-orm conditions (eq, and, or, not, gt, gte, lt, lte, like,
    // inArray) from drizzle-orm — import whichever you need here.
    return undefined;
  }
}

/**
 * Transactional repository wrapper for Drizzle
 */
class Transactional${className}Repository implements I${className}Repository {
  constructor(private readonly tx: DrizzleDb) {}

  async findById(id: string): Promise<${className} | null> {
    const [row] = await this.tx.select().from(${varName}Table).where(eq(${varName}Table.id, id)).limit(1);
    return row ? this.toDomain(row) : null;
  }

  async findAll(): Promise<${className}[]> {
    const rows = await this.tx.select().from(${varName}Table);
    return rows.map((r: any) => this.toDomain(r));
  }

  async findBySpec(_spec: Specification<${className}>): Promise<${className}[]> {
    return [];
  }

  async findOneBySpec(_spec: Specification<${className}>): Promise<${className} | null> {
    return null;
  }

  async countBySpec(_spec: Specification<${className}>): Promise<number> {
    return 0;
  }

  async exists(_spec: Specification<${className}>): Promise<boolean> {
    return false;
  }

  async save(entity: ${className}): Promise<${className}> {
    const data = this.toRow(entity);
    const [row] = await this.tx
      .insert(${varName}Table)
      .values(data)
      .onConflictDoUpdate({ target: ${varName}Table.id, set: data })
      .returning();
    return this.toDomain(row);
  }

  async saveMany(entities: ${className}[]): Promise<${className}[]> {
    return Promise.all(entities.map((e) => this.save(e)));
  }

  async delete(id: string): Promise<void> {
    await this.tx.delete(${varName}Table).where(eq(${varName}Table.id, id));
  }

  async deleteBySpec(_spec: Specification<${className}>): Promise<number> {
    return 0;
  }

  async transaction<T>(operation: (repo: I${className}Repository) => Promise<T>): Promise<T> {
    return operation(this);
  }

  private toDomain(row: any): ${className} {
    return new ${className}(row);
  }

  private toRow(entity: ${className}): any {
    return { ...entity };
  }
}
`;
}

function generatePrismaRepository(entityName: string): string {
  const className = toPascalCase(entityName);
  const varName = toCamelCase(entityName);

  return `import { Injectable } from '@nestjs/common';
import { PrismaService } from '@shared/prisma/prisma.service';
import { ${className} } from '@domain/${toKebabCase(entityName)}.entity';
import { I${className}Repository, QueryOptions, PaginatedResult } from './${toKebabCase(entityName)}.repository.interface';
import { Specification } from '@shared/specifications/specification';

/**
 * Prisma implementation of ${className} Repository
 */
@Injectable()
export class ${className}Repository implements I${className}Repository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<${className} | null> {
    const result = await this.prisma.${varName}.findUnique({
      where: { id },
    });
    return result ? this.toDomain(result) : null;
  }

  async findAll(): Promise<${className}[]> {
    const results = await this.prisma.${varName}.findMany();
    return results.map(r => this.toDomain(r));
  }

  async findBySpec(spec: Specification<${className}>): Promise<${className}[]> {
    const where = this.specToWhere(spec);
    const results = await this.prisma.${varName}.findMany({ where });
    return results.map(r => this.toDomain(r));
  }

  async findOneBySpec(spec: Specification<${className}>): Promise<${className} | null> {
    const where = this.specToWhere(spec);
    const result = await this.prisma.${varName}.findFirst({ where });
    return result ? this.toDomain(result) : null;
  }

  async countBySpec(spec: Specification<${className}>): Promise<number> {
    const where = this.specToWhere(spec);
    return this.prisma.${varName}.count({ where });
  }

  async exists(spec: Specification<${className}>): Promise<boolean> {
    const count = await this.countBySpec(spec);
    return count > 0;
  }

  async save(entity: ${className}): Promise<${className}> {
    const data = this.toDatabase(entity);
    const result = await this.prisma.${varName}.upsert({
      where: { id: entity.id },
      create: data,
      update: data,
    });
    return this.toDomain(result);
  }

  async saveMany(entities: ${className}[]): Promise<${className}[]> {
    const results = await Promise.all(
      entities.map(entity => this.save(entity))
    );
    return results;
  }

  async delete(id: string): Promise<void> {
    await this.prisma.${varName}.delete({ where: { id } });
  }

  async deleteBySpec(spec: Specification<${className}>): Promise<number> {
    const where = this.specToWhere(spec);
    const result = await this.prisma.${varName}.deleteMany({ where });
    return result.count;
  }

  async transaction<T>(operation: (repo: I${className}Repository) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      const transactionalRepo = new Transactional${className}Repository(tx as any);
      return operation(transactionalRepo);
    });
  }

  async findPaginated(
    options: QueryOptions<${className}>,
    page: number = 1,
    pageSize: number = 10,
  ): Promise<PaginatedResult<${className}>> {
    const where = options.where || {};
    const orderBy = options.orderBy?.map(o => ({ [o.field]: o.direction.toLowerCase() })) || [];

    const [items, total] = await Promise.all([
      this.prisma.${varName}.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: options.relations?.reduce((acc, r) => ({ ...acc, [r]: true }), {}),
      }),
      this.prisma.${varName}.count({ where }),
    ]);

    const totalPages = Math.ceil(total / pageSize);

    return {
      items: items.map(i => this.toDomain(i)),
      total,
      page,
      pageSize,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    };
  }

  private toDomain(data: any): ${className} {
    // Map database record to domain entity
    return new ${className}(data);
  }

  private toDatabase(entity: ${className}): any {
    // Map domain entity to database record
    return { ...entity };
  }

  private specToWhere(spec: Specification<${className}>): any {
    // Convert specification to Prisma where clause
    return {};
  }
}

/**
 * Transactional repository wrapper for Prisma
 */
class Transactional${className}Repository implements I${className}Repository {
  constructor(private readonly tx: any) {}

  // Implement all methods using this.tx instead of prisma
  async findById(id: string): Promise<${className} | null> {
    const result = await this.tx.${varName}.findUnique({ where: { id } });
    return result ? this.toDomain(result) : null;
  }

  async findAll(): Promise<${className}[]> {
    const results = await this.tx.${varName}.findMany();
    return results.map((r: any) => this.toDomain(r));
  }

  async findBySpec(spec: Specification<${className}>): Promise<${className}[]> {
    return [];
  }

  async findOneBySpec(spec: Specification<${className}>): Promise<${className} | null> {
    return null;
  }

  async countBySpec(spec: Specification<${className}>): Promise<number> {
    return 0;
  }

  async exists(spec: Specification<${className}>): Promise<boolean> {
    return false;
  }

  async save(entity: ${className}): Promise<${className}> {
    const data = this.toDatabase(entity);
    const result = await this.tx.${varName}.upsert({
      where: { id: entity.id },
      create: data,
      update: data,
    });
    return this.toDomain(result);
  }

  async saveMany(entities: ${className}[]): Promise<${className}[]> {
    return Promise.all(entities.map(e => this.save(e)));
  }

  async delete(id: string): Promise<void> {
    await this.tx.${varName}.delete({ where: { id } });
  }

  async deleteBySpec(spec: Specification<${className}>): Promise<number> {
    return 0;
  }

  async transaction<T>(operation: (repo: I${className}Repository) => Promise<T>): Promise<T> {
    return operation(this);
  }

  private toDomain(data: any): ${className} {
    return new ${className}(data);
  }

  private toDatabase(entity: ${className}): any {
    return { ...entity };
  }
}
`;
}

/**
 * Setup base repository infrastructure
 */
export async function setupRepositoryInfrastructure(
  basePath: string,
  _options: RepositoryOptions = {},
): Promise<void> {
  console.log(chalk.bold.blue('\n📦 Setting up Repository Infrastructure\n'));

  const sharedPath = path.join(basePath, 'src/shared');
  const specPath = path.join(sharedPath, 'specifications');
  const repoPath = path.join(sharedPath, 'repositories');

  // Create directories
  [specPath, repoPath].forEach((p) => {
    if (!fs.existsSync(p)) {
      fs.mkdirSync(p, { recursive: true });
    }
  });

  // Generate specification pattern
  const specContent = generateSpecificationPattern();
  fs.writeFileSync(path.join(specPath, 'specification.ts'), specContent);
  console.log(chalk.green(`  ✓ Created specification pattern`));

  // Generate base repository
  const baseRepoContent = generateBaseRepository();
  fs.writeFileSync(path.join(repoPath, 'base.repository.ts'), baseRepoContent);
  console.log(chalk.green(`  ✓ Created base repository`));

  // Generate unit of work
  const uowContent = generateUnitOfWork();
  fs.writeFileSync(path.join(repoPath, 'unit-of-work.ts'), uowContent);
  console.log(chalk.green(`  ✓ Created unit of work`));

  console.log(chalk.bold.green('\n✅ Repository infrastructure ready!\n'));
}

function generateSpecificationPattern(): string {
  return `/**
 * Specification Pattern
 * Type-safe query specifications for repositories
 */

/**
 * Base specification interface
 */
export interface Specification<T> {
  isSatisfiedBy(candidate: T): boolean;
  accept(visitor: SpecificationVisitor<T>): void;
}

/**
 * Specification visitor interface
 */
export interface SpecificationVisitor<T> {
  visitAnd(specs: Specification<T>[]): void;
  visitOr(specs: Specification<T>[]): void;
  visitNot(spec: Specification<T>): void;
  visitProperty(field: string, operator: string, value: any): void;
}

/**
 * Base specification class
 */
export abstract class BaseSpecification<T> implements Specification<T> {
  abstract isSatisfiedBy(candidate: T): boolean;
  abstract accept(visitor: SpecificationVisitor<T>): void;

  and(other: Specification<T>): Specification<T> {
    return new AndSpecification([this, other]);
  }

  or(other: Specification<T>): Specification<T> {
    return new OrSpecification([this, other]);
  }

  not(): Specification<T> {
    return new NotSpecification(this);
  }
}

/**
 * AND specification
 */
export class AndSpecification<T> extends BaseSpecification<T> {
  constructor(private readonly specs: Specification<T>[]) {
    super();
  }

  isSatisfiedBy(candidate: T): boolean {
    return this.specs.every(spec => spec.isSatisfiedBy(candidate));
  }

  accept(visitor: SpecificationVisitor<T>): void {
    visitor.visitAnd(this.specs);
  }
}

/**
 * OR specification
 */
export class OrSpecification<T> extends BaseSpecification<T> {
  constructor(private readonly specs: Specification<T>[]) {
    super();
  }

  isSatisfiedBy(candidate: T): boolean {
    return this.specs.some(spec => spec.isSatisfiedBy(candidate));
  }

  accept(visitor: SpecificationVisitor<T>): void {
    visitor.visitOr(this.specs);
  }
}

/**
 * NOT specification
 */
export class NotSpecification<T> extends BaseSpecification<T> {
  constructor(private readonly spec: Specification<T>) {
    super();
  }

  isSatisfiedBy(candidate: T): boolean {
    return !this.spec.isSatisfiedBy(candidate);
  }

  accept(visitor: SpecificationVisitor<T>): void {
    visitor.visitNot(this.spec);
  }
}

/**
 * Property specification
 */
export class PropertySpecification<T, K extends keyof T> extends BaseSpecification<T> {
  constructor(
    private readonly field: K,
    private readonly operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'in',
    private readonly value: T[K] | T[K][],
  ) {
    super();
  }

  isSatisfiedBy(candidate: T): boolean {
    const fieldValue = candidate[this.field];

    switch (this.operator) {
      case 'eq':
        return fieldValue === this.value;
      case 'neq':
        return fieldValue !== this.value;
      case 'gt':
        return fieldValue > (this.value as T[K]);
      case 'gte':
        return fieldValue >= (this.value as T[K]);
      case 'lt':
        return fieldValue < (this.value as T[K]);
      case 'lte':
        return fieldValue <= (this.value as T[K]);
      case 'like':
        return String(fieldValue).includes(String(this.value));
      case 'in':
        return (this.value as T[K][]).includes(fieldValue);
      default:
        return false;
    }
  }

  accept(visitor: SpecificationVisitor<T>): void {
    visitor.visitProperty(String(this.field), this.operator, this.value);
  }
}

/**
 * Specification builder for fluent API
 */
export class SpecificationBuilder<T> {
  private specs: Specification<T>[] = [];

  where<K extends keyof T>(field: K, operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'in', value: T[K] | T[K][]): this {
    this.specs.push(new PropertySpecification(field, operator, value));
    return this;
  }

  equals<K extends keyof T>(field: K, value: T[K]): this {
    return this.where(field, 'eq', value);
  }

  notEquals<K extends keyof T>(field: K, value: T[K]): this {
    return this.where(field, 'neq', value);
  }

  greaterThan<K extends keyof T>(field: K, value: T[K]): this {
    return this.where(field, 'gt', value);
  }

  lessThan<K extends keyof T>(field: K, value: T[K]): this {
    return this.where(field, 'lt', value);
  }

  contains<K extends keyof T>(field: K, value: string): this {
    return this.where(field, 'like', value as unknown as T[K]);
  }

  in<K extends keyof T>(field: K, values: T[K][]): this {
    return this.where(field, 'in', values);
  }

  build(): Specification<T> {
    if (this.specs.length === 0) {
      return new TrueSpecification();
    }
    if (this.specs.length === 1) {
      return this.specs[0];
    }
    return new AndSpecification(this.specs);
  }
}

/**
 * Always true specification
 */
export class TrueSpecification<T> extends BaseSpecification<T> {
  isSatisfiedBy(_candidate: T): boolean {
    return true;
  }

  accept(_visitor: SpecificationVisitor<T>): void {
    // No-op
  }
}

/**
 * Create a specification builder
 */
export function spec<T>(): SpecificationBuilder<T> {
  return new SpecificationBuilder<T>();
}
`;
}

function generateBaseRepository(): string {
  return `/**
 * Base Repository Interface
 * Generic repository contract for all entities
 */

import { Specification } from '../specifications/specification';

/**
 * Generic repository interface
 */
export interface IRepository<T, ID = string> {
  findById(id: ID): Promise<T | null>;
  findAll(): Promise<T[]>;
  findBySpec(spec: Specification<T>): Promise<T[]>;
  findOneBySpec(spec: Specification<T>): Promise<T | null>;
  countBySpec(spec: Specification<T>): Promise<number>;
  exists(spec: Specification<T>): Promise<boolean>;
  save(entity: T): Promise<T>;
  saveMany(entities: T[]): Promise<T[]>;
  delete(id: ID): Promise<void>;
  deleteBySpec(spec: Specification<T>): Promise<number>;
}

/**
 * Read-only repository interface
 */
export interface IReadRepository<T, ID = string> {
  findById(id: ID): Promise<T | null>;
  findAll(): Promise<T[]>;
  findBySpec(spec: Specification<T>): Promise<T[]>;
  findOneBySpec(spec: Specification<T>): Promise<T | null>;
  countBySpec(spec: Specification<T>): Promise<number>;
  exists(spec: Specification<T>): Promise<boolean>;
}

/**
 * Write-only repository interface
 */
export interface IWriteRepository<T, ID = string> {
  save(entity: T): Promise<T>;
  saveMany(entities: T[]): Promise<T[]>;
  delete(id: ID): Promise<void>;
  deleteBySpec(spec: Specification<T>): Promise<number>;
}

/**
 * Aggregate repository with event publishing
 */
export interface IAggregateRepository<T, ID = string> extends IRepository<T, ID> {
  saveWithEvents(aggregate: T): Promise<T>;
}
`;
}

function generateUnitOfWork(): string {
  return `/**
 * Unit of Work Pattern
 * Manages transactions across multiple repositories
 *
 * Drizzle transactions are scoped to a callback (\`db.transaction(async (tx) => ...)\`)
 * rather than begin/commit/rollback calls, so this wraps that shape behind the
 * same IUnitOfWork contract used elsewhere in the codebase.
 */

import { Inject, Injectable } from '@nestjs/common';
import { DRIZZLE, DrizzleDb } from '@shared/database/drizzle.provider';

/**
 * Unit of Work interface
 */
export interface IUnitOfWork {
  run<T>(work: (tx: DrizzleDb) => Promise<T>): Promise<T>;
}

/**
 * Drizzle Unit of Work implementation
 */
@Injectable()
export class UnitOfWork implements IUnitOfWork {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async run<T>(work: (tx: DrizzleDb) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => work(tx as unknown as DrizzleDb));
  }
}

/**
 * Unit of Work decorator. The decorated method's class must inject a
 * \`unitOfWork: UnitOfWork\` member and accept the transactional client as its
 * first argument.
 */
export function Transactional(): MethodDecorator {
  return function (
    target: any,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const unitOfWork: UnitOfWork = (this as any).unitOfWork;

      if (!unitOfWork) {
        throw new Error('UnitOfWork not injected');
      }

      return unitOfWork.run((tx) => originalMethod.apply(this, [tx, ...args]));
    };

    return descriptor;
  };
}
`;
}
