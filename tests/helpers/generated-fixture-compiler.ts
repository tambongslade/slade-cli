import * as fs from 'fs-extra';
import * as path from 'path';
import ts from 'typescript';

export type FixtureOrm = 'drizzle' | 'prisma';

function getGeneratedDependencyTypes(_softDelete: boolean): string {
  return `
declare module "@nestjs/common" {
  export function Injectable(): ClassDecorator;
  export function Inject(token: unknown): ParameterDecorator;
  export class NotFoundException extends Error {}
}

declare module "@nestjs/testing" {
  export interface TestingModule {
    get<T = any>(token: unknown): T;
  }

  export const Test: {
    createTestingModule(metadata: unknown): {
      compile(): Promise<TestingModule>;
    };
  };
}

declare module "@nestjs/cqrs" {
  export interface IQueryHandler<TQuery, TResult> {
    execute(query: TQuery): Promise<TResult> | TResult;
  }
  export function QueryHandler(query: Function): ClassDecorator;
}

declare module "@nestjs/swagger" {
  export function ApiProperty(options?: unknown): PropertyDecorator;
  export function ApiPropertyOptional(options?: unknown): PropertyDecorator;
}

declare module "class-transformer" {
  export function Expose(): PropertyDecorator;
  export function Type(factory: () => unknown): PropertyDecorator;
}

declare module "class-validator" {
  export function IsOptional(): PropertyDecorator;
  export function IsInt(): PropertyDecorator;
  export function Min(value: number): PropertyDecorator;
  export function Max(value: number): PropertyDecorator;
  export function IsString(): PropertyDecorator;
  export function IsIn(values: readonly unknown[]): PropertyDecorator;
}

declare module "drizzle-orm/pg-core" {
  export interface PgColumnBuilder<TData> {
    notNull(): PgColumnBuilder<TData>;
    unique(): PgColumnBuilder<TData>;
    default(value: TData): PgColumnBuilder<TData>;
    defaultRandom(): PgColumnBuilder<TData>;
    defaultNow(): PgColumnBuilder<TData>;
    primaryKey(): PgColumnBuilder<TData>;
    references(
      ref: () => PgColumnBuilder<any>,
      options?: { onDelete?: string },
    ): PgColumnBuilder<TData>;
  }

  export function uuid(name: string): PgColumnBuilder<string>;
  export function text(name: string): PgColumnBuilder<string>;
  export function integer(name: string): PgColumnBuilder<number>;
  export function doublePrecision(name: string): PgColumnBuilder<number>;
  export function numeric(
    name: string,
    options: { mode: "number"; precision?: number; scale?: number },
  ): PgColumnBuilder<number>;
  export function numeric(
    name: string,
    options?: { mode?: "string"; precision?: number; scale?: number },
  ): PgColumnBuilder<string>;
  export function boolean(name: string): PgColumnBuilder<boolean>;
  export function date(name: string): PgColumnBuilder<string>;
  export function timestamp(
    name: string,
    options?: { withTimezone?: boolean },
  ): PgColumnBuilder<Date>;
  export function jsonb(name: string): PgColumnBuilder<unknown>;

  type ColumnsShape = Record<string, PgColumnBuilder<any>>;
  type DataOf<T> = T extends PgColumnBuilder<infer D> ? D : never;
  type RowShape<T extends ColumnsShape> = { [K in keyof T]: DataOf<T[K]> };

  export interface PgTable<TColumns extends ColumnsShape> {
    $inferSelect: RowShape<TColumns>;
    $inferInsert: Partial<RowShape<TColumns>>;
  }

  export function pgTable<TColumns extends ColumnsShape>(
    name: string,
    columns: TColumns,
  ): PgTable<TColumns> & TColumns;
}

declare module "drizzle-orm" {
  export function eq(column: unknown, value: unknown): unknown;
  export function and(...conditions: unknown[]): unknown;
  export function or(...conditions: unknown[]): unknown;
  export function not(condition: unknown): unknown;
  export function asc(column: unknown): unknown;
  export function desc(column: unknown): unknown;
  export function isNull(column: unknown): unknown;
  export function inArray(column: unknown, values: unknown[]): unknown;
  export function count(column?: unknown): unknown;
  export function sql<T = unknown>(strings: TemplateStringsArray, ...values: unknown[]): T;
  export type SQL<T = unknown> = unknown;
}

declare module "@shared/database/drizzle.provider" {
  export const DRIZZLE: unique symbol;
  export type DrizzleDb = any;
}

declare module "@prisma/client" {
  export interface Invoice {
    id: string;
    amount: number;
    reference: string;
    is_active: boolean;
    created_at: Date;
    updated_at: Date;
${_softDelete ? '    deleted_at: Date | null;' : ''}
  }

  export namespace Prisma {
    export type SortOrder = "asc" | "desc";

    export interface InvoiceWhereInput {
      id?: string;
      amount?: number;
      reference?: string;
      is_active?: boolean;
      created_at?: Date;
      updated_at?: Date;
${_softDelete ? '      deleted_at?: Date | null;' : ''}
    }

    export interface InvoiceOrderByWithRelationInput {
      id?: SortOrder;
      amount?: SortOrder;
      reference?: SortOrder;
      is_active?: SortOrder;
      created_at?: SortOrder;
      updated_at?: SortOrder;
${_softDelete ? '      deleted_at?: SortOrder;' : ''}
    }
  }
}

declare module "@prisma/prisma.service" {
  import type { Invoice } from "@prisma/client";

  interface InvoiceDelegate {
    create(options: unknown): Promise<Invoice>;
    findFirst(options: unknown): Promise<Invoice | null>;
    findMany(options?: unknown): Promise<Invoice[]>;
    count(options?: unknown): Promise<number>;
    update(options: unknown): Promise<Invoice>;
    delete(options: unknown): Promise<Invoice>;
  }

  export class PrismaService {
    invoice: InvoiceDelegate;
  }
}
`;
}

export async function compileGeneratedRepositoryFixture(
  fixturePath: string,
  orm: FixtureOrm,
  softDelete: boolean,
): Promise<string[]> {
  const typesPath = path.join(fixturePath, 'generated-dependency-types.d.ts');
  await fs.writeFile(typesPath, getGeneratedDependencyTypes(softDelete), 'utf-8');

  const modulePath = path.join(fixturePath, 'src/modules/billing');
  const rootNames = [
    typesPath,
    path.join(modulePath, 'application/domain/entities/invoice.entity.ts'),
    path.join(modulePath, 'application/queries/get-all-invoices.query.ts'),
    path.join(modulePath, 'infrastructure/mappers/invoice.mapper.ts'),
    path.join(modulePath, 'infrastructure/repositories/invoice.repository.ts'),
    path.join(modulePath, 'infrastructure/repositories/invoice.repository.spec.ts'),
  ];

  if (orm === 'drizzle') {
    rootNames.push(path.join(modulePath, 'infrastructure/orm-entities/invoice.orm-entity.ts'));
  }

  const program = ts.createProgram({
    rootNames,
    options: {
      baseUrl: path.join(fixturePath, 'src'),
      esModuleInterop: true,
      experimentalDecorators: true,
      forceConsistentCasingInFileNames: true,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      noEmit: true,
      paths: {
        '@modules/*': ['modules/*'],
      },
      skipLibCheck: true,
      strict: true,
      strictPropertyInitialization: false,
      target: ts.ScriptTarget.ES2020,
      typeRoots: [path.resolve(__dirname, '../../node_modules/@types')],
      types: ['jest'],
    },
  });

  return ts
    .getPreEmitDiagnostics(program)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, ts.sys.newLine));
}
