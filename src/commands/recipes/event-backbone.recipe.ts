import * as path from 'path';
import chalk from 'chalk';
import { ensureDir, writeFile } from '../../utils/file.utils';
import { applyBusinessReferenceIdentifiersRecipe } from './business-reference-identifiers.recipe';
import { applyPlatformContextRecipe } from './platform-context.recipe';

export async function applyEventBackboneRecipe(basePath: string) {
  const sharedPath = path.join(basePath, 'src/shared');
  const eventBackbonePath = path.join(sharedPath, 'event-backbone');
  const entitiesPath = path.join(eventBackbonePath, 'entities');
  const publishersPath = path.join(eventBackbonePath, 'publishers');

  await applyBusinessReferenceIdentifiersRecipe(basePath);
  await applyPlatformContextRecipe(basePath);
  await ensureDir(eventBackbonePath);
  await ensureDir(entitiesPath);
  await ensureDir(publishersPath);

  const constantsContent = `export const EVENT_BACKBONE_PUBLISHER = Symbol("EVENT_BACKBONE_PUBLISHER");

export const EVENT_BACKBONE_TRANSPORT = {
  relayHttp: "relay-http",
  pulsar: "pulsar",
  none: "none",
} as const;

export type EventBackboneTransport =
  (typeof EVENT_BACKBONE_TRANSPORT)[keyof typeof EVENT_BACKBONE_TRANSPORT];

export const EVENT_BACKBONE_ENV = {
  transport: "EVENT_BACKBONE_TRANSPORT",
  relayEnabled: "EVENT_BACKBONE_RELAY_ENABLED",
  relayBatchSize: "EVENT_BACKBONE_RELAY_BATCH_SIZE",
  relayMaxAttempts: "EVENT_BACKBONE_RELAY_MAX_ATTEMPTS",
  relayRetryBaseMs: "EVENT_BACKBONE_RELAY_RETRY_BASE_MS",
  relayHttpUrl: "EVENT_BACKBONE_RELAY_HTTP_URL",
  relayServiceCredential: "EVENT_BACKBONE_RELAY_SERVICE_CREDENTIAL",
  relayAudience: "EVENT_BACKBONE_RELAY_AUDIENCE",
  relayTimeoutMs: "EVENT_BACKBONE_RELAY_TIMEOUT_MS",
  pulsarEnabled: "PULSAR_ENABLED",
  pulsarServiceUrl: "PULSAR_SERVICE_URL",
  pulsarTenant: "PULSAR_TENANT",
  pulsarNamespace: "PULSAR_NAMESPACE",
  pulsarTopicPrefix: "PULSAR_TOPIC_PREFIX",
} as const;
`;

  await writeFile(path.join(eventBackbonePath, 'event-backbone.constants.ts'), constantsContent);

  const typesContent = `import type { DrizzleDb } from "@shared/database/drizzle.provider";

export type EventPayload = Record<string, unknown>;

/**
 * The transaction handle produced by \`db.transaction(async (tx) => ...)\`.
 * Derived structurally from \`DrizzleDb\` so it always matches the installed
 * drizzle-orm version, and it deliberately carries members (like \`rollback\`)
 * that a plain \`DrizzleDb\` doesn't — passing the top-level \`db\` where a
 * \`DrizzleTransaction\` is expected is a type error, which is what enforces
 * "this must run inside an active transaction" at compile time.
 */
export type DrizzleTransaction = Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0];

export enum EventPiiClassification {
  None = "NONE",
  Internal = "INTERNAL",
  Restricted = "RESTRICTED",
  Sensitive = "SENSITIVE",
}

export interface EventBackboneActorMetadata {
  subjectId?: string;
  businessId?: string;
  applicationId?: string;
  serviceName?: string;
}

export interface EventBackboneMetadata {
  schemaVersion?: number;
  correlationId?: string;
  causationId?: string;
  idempotencyKey?: string;
  actor?: EventBackboneActorMetadata;
  businessId?: string;
  applicationId?: string;
  piiClassification?: EventPiiClassification;
  tenantId?: string;
  traceId?: string;
  source?: string;
  [key: string]: unknown;
}

export interface EventBackboneEnvelope<TPayload extends EventPayload = EventPayload> {
  id: string;
  schemaVersion: number;
  reference?: string;
  type: string;
  source: string;
  aggregateType: string;
  aggregateId: string;
  streamId: string;
  version?: number;
  subject?: string;
  payload: TPayload;
  metadata: EventBackboneMetadata;
  occurredAt: string;
}

export interface AppendDomainEventInput<TPayload extends EventPayload = EventPayload> {
  type: string;
  aggregateType: string;
  aggregateId: string;
  payload: TPayload;
  metadata?: EventBackboneMetadata;
  occurredAt?: Date;
  reference?: string;
}

export interface AppendDomainEventsInput {
  streamId: string;
  expectedVersion?: number;
  events: AppendDomainEventInput[];
}

export interface StoredDomainEvent<TPayload extends EventPayload = EventPayload> {
  globalSeq: string;
  eventId: string;
  reference?: string | null;
  streamId: string;
  version: number;
  type: string;
  aggregateType: string;
  aggregateId: string;
  payload: TPayload;
  metadata: EventBackboneMetadata;
  occurredAt: Date;
  createdAt: Date;
}

export enum OutboxEventStatus {
  Pending = "PENDING",
  Publishing = "PUBLISHING",
  Published = "PUBLISHED",
  Failed = "FAILED",
}

export interface OutboxPublishInput<TPayload extends EventPayload = EventPayload> {
  eventId: string;
  type: string;
  source: string;
  aggregateType: string;
  aggregateId: string;
  streamId: string;
  version: number;
  payload: TPayload;
  metadata?: EventBackboneMetadata;
  occurredAt?: Date;
  reference?: string;
  subject?: string;
}

export interface EventBackbonePublisher {
  publish(envelope: EventBackboneEnvelope): Promise<void>;
}
`;

  await writeFile(path.join(eventBackbonePath, 'event-backbone.types.ts'), typesContent);

  const envContent = `import * as Joi from "joi";

export const eventBackboneEnvSchema = {
  EVENT_BACKBONE_TRANSPORT: Joi.string()
    .valid("relay-http", "pulsar", "none")
    .default("none"),
  EVENT_BACKBONE_RELAY_ENABLED: Joi.boolean().truthy("true").falsy("false").default(true),
  EVENT_BACKBONE_RELAY_BATCH_SIZE: Joi.number().integer().min(1).max(500).default(50),
  EVENT_BACKBONE_RELAY_MAX_ATTEMPTS: Joi.number().integer().min(1).max(100).default(10),
  EVENT_BACKBONE_RELAY_RETRY_BASE_MS: Joi.number().integer().min(1000).default(30000),
  EVENT_BACKBONE_RELAY_HTTP_URL: Joi.string()
    .uri()
    .when("EVENT_BACKBONE_TRANSPORT", {
      is: "relay-http",
      then: Joi.required(),
      otherwise: Joi.string().allow("").optional(),
    }),
  EVENT_BACKBONE_RELAY_SERVICE_CREDENTIAL: Joi.string()
    .min(1)
    .when("EVENT_BACKBONE_TRANSPORT", {
      is: "relay-http",
      then: Joi.required(),
      otherwise: Joi.string().allow("").optional(),
    }),
  EVENT_BACKBONE_RELAY_AUDIENCE: Joi.string()
    .min(1)
    .when("EVENT_BACKBONE_TRANSPORT", {
      is: "relay-http",
      then: Joi.required(),
      otherwise: Joi.string().allow("").optional(),
    }),
  EVENT_BACKBONE_RELAY_TIMEOUT_MS: Joi.number().integer().min(1000).max(60000).default(10000),
  PULSAR_ENABLED: Joi.boolean().truthy("true").falsy("false").default(false),
  PULSAR_SERVICE_URL: Joi.string()
    .pattern(/^pulsars?:\\/\\/.+/)
    .when("EVENT_BACKBONE_TRANSPORT", {
      is: "pulsar",
      then: Joi.required(),
      otherwise: Joi.when("PULSAR_ENABLED", {
        is: true,
        then: Joi.required(),
        otherwise: Joi.string().allow("").optional(),
      }),
    }),
  PULSAR_TENANT: Joi.string().default("public"),
  PULSAR_NAMESPACE: Joi.string().default("default"),
  PULSAR_TOPIC_PREFIX: Joi.string().allow("").default(""),
};
`;

  await writeFile(path.join(eventBackbonePath, 'event-backbone.env.ts'), envContent);

  const errorsContent = `export class EventStreamConcurrencyError extends Error {
  constructor(streamId: string, expectedVersion: number | undefined, actualVersion: number) {
    super(
      "Event stream concurrency conflict for " +
        streamId +
        ": expected " +
        String(expectedVersion) +
        ", actual " +
        String(actualVersion),
    );
    this.name = "EventStreamConcurrencyError";
  }
}

export class OutboxTransactionRequiredError extends Error {
  constructor() {
    super("Outbox writes must use the same active database transaction as the business write");
    this.name = "OutboxTransactionRequiredError";
  }
}

export class RelayHttpRetryableError extends Error {
  readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "RelayHttpRetryableError";
    this.statusCode = statusCode;
  }
}

export class RelayHttpNonRetryableError extends Error {
  readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "RelayHttpNonRetryableError";
    this.statusCode = statusCode;
  }
}
`;

  await writeFile(path.join(eventBackbonePath, 'event-backbone.errors.ts'), errorsContent);

  const eventStoreEntityContent = `import {
  bigserial,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Append-only event store: the source of truth for every domain event.
 * \`idx_event_store_event_id\` is a UNIQUE index — it's what makes replay
 * safe: re-appending an event with the same eventId (e.g. after a retried
 * write) fails with a unique violation instead of duplicating history.
 */
export const eventStoreTable = pgTable(
  "event_store",
  {
    globalSeq: bigserial("global_seq", { mode: "bigint" }).primaryKey(),
    eventId: uuid("event_id").notNull(),
    reference: varchar("reference", { length: 96 }),
    streamId: varchar("stream_id", { length: 160 }).notNull(),
    version: integer("version").notNull(),
    type: varchar("type", { length: 160 }).notNull(),
    aggregateType: varchar("aggregate_type", { length: 96 }).notNull(),
    aggregateId: varchar("aggregate_id", { length: 96 }).notNull(),
    payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
    metadata: jsonb("metadata").notNull().default({}).$type<Record<string, unknown>>(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uqStreamVersion: uniqueIndex("uq_event_store_stream_version").on(
      table.streamId,
      table.version,
    ),
    idxStream: index("idx_event_store_stream").on(table.streamId),
    idxEventId: uniqueIndex("idx_event_store_event_id").on(table.eventId),
    idxType: index("idx_event_store_type").on(table.type),
    idxAggregate: index("idx_event_store_aggregate").on(
      table.aggregateType,
      table.aggregateId,
    ),
  }),
);

export type EventStoreRow = typeof eventStoreTable.$inferSelect;
export type NewEventStoreRow = typeof eventStoreTable.$inferInsert;
`;

  await writeFile(path.join(entitiesPath, 'event-store.orm-entity.ts'), eventStoreEntityContent);

  const outboxEntityContent = `import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { OutboxEventStatus } from "../event-backbone.types";

/**
 * Transactional outbox: rows are written in the same DB transaction as the
 * business/event-store write (see OutboxService.enqueue), then relayed to
 * the configured transport by OutboxRelayService. \`idx_outbox_events_reference\`
 * is a partial UNIQUE index so a caller-supplied idempotency reference can
 * never be enqueued twice.
 */
export const outboxEventsTable = pgTable(
  "outbox_events",
  {
    id: uuid("id").primaryKey(),
    reference: varchar("reference", { length: 96 }),
    eventType: varchar("event_type", { length: 160 }).notNull(),
    source: varchar("source", { length: 160 }).notNull(),
    aggregateType: varchar("aggregate_type", { length: 96 }).notNull(),
    aggregateId: varchar("aggregate_id", { length: 96 }).notNull(),
    streamId: varchar("stream_id", { length: 160 }).notNull(),
    version: integer("version").notNull(),
    subject: varchar("subject", { length: 160 }),
    payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
    metadata: jsonb("metadata").notNull().default({}).$type<Record<string, unknown>>(),
    status: varchar("status", { length: 20 }).notNull().default(OutboxEventStatus.Pending),
    attempts: integer("attempts").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    idxStatusAvailable: index("idx_outbox_events_status_available").on(
      table.status,
      table.availableAt,
    ),
    idxAggregate: index("idx_outbox_events_aggregate").on(
      table.aggregateType,
      table.aggregateId,
    ),
    idxReference: uniqueIndex("idx_outbox_events_reference")
      .on(table.reference)
      .where(sql\`"reference" IS NOT NULL\`),
    statusCheck: check(
      "chk_outbox_events_status",
      sql\`\${table.status} IN ('PENDING', 'PUBLISHING', 'PUBLISHED', 'FAILED')\`,
    ),
  }),
);

export type OutboxEventRow = typeof outboxEventsTable.$inferSelect;
export type NewOutboxEventRow = typeof outboxEventsTable.$inferInsert;
`;

  await writeFile(path.join(entitiesPath, 'outbox-event.orm-entity.ts'), outboxEntityContent);

  const checkpointEntityContent = `import { bigint, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";

export const projectionCheckpointsTable = pgTable("projection_checkpoints", {
  projection: varchar("projection", { length: 120 }).primaryKey(),
  lastSeq: bigint("last_seq", { mode: "bigint" }).notNull().default(0n),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ProjectionCheckpointRow = typeof projectionCheckpointsTable.$inferSelect;
export type NewProjectionCheckpointRow = typeof projectionCheckpointsTable.$inferInsert;
`;

  await writeFile(
    path.join(entitiesPath, 'projection-checkpoint.orm-entity.ts'),
    checkpointEntityContent,
  );

  const eventStoreServiceContent = `import { randomUUID } from "crypto";
import { Inject, Injectable } from "@nestjs/common";
import { asc, desc, eq, gt } from "drizzle-orm";
import { DRIZZLE, DrizzleDb } from "@shared/database/drizzle.provider";
import {
  AppendDomainEventsInput,
  DrizzleTransaction,
  StoredDomainEvent,
} from "./event-backbone.types";
import { EventStreamConcurrencyError } from "./event-backbone.errors";
import { EventStoreRow, eventStoreTable } from "./entities/event-store.orm-entity";
import { projectionCheckpointsTable } from "./entities/projection-checkpoint.orm-entity";

@Injectable()
export class EventStoreService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async append(
    input: AppendDomainEventsInput,
    tx: DrizzleTransaction,
  ): Promise<StoredDomainEvent[]> {
    this.assertActiveTransaction(tx);

    const currentVersion = await this.currentVersion(input.streamId, tx);
    if (
      typeof input.expectedVersion === "number" &&
      input.expectedVersion !== currentVersion
    ) {
      throw new EventStreamConcurrencyError(
        input.streamId,
        input.expectedVersion,
        currentVersion,
      );
    }

    const rows = input.events.map((event, index) => ({
      eventId: randomUUID(),
      reference: event.reference ?? null,
      streamId: input.streamId,
      version: currentVersion + index + 1,
      type: event.type,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      payload: event.payload,
      metadata: event.metadata ?? {},
      occurredAt: event.occurredAt ?? new Date(),
    }));

    try {
      const saved = await tx.insert(eventStoreTable).values(rows).returning();
      return saved.map((row) => this.toStoredEvent(row));
    } catch (error) {
      if (!this.isUniqueViolation(error)) {
        throw error;
      }

      throw new EventStreamConcurrencyError(
        input.streamId,
        input.expectedVersion,
        currentVersion,
      );
    }
  }

  async currentVersion(
    streamId: string,
    manager: DrizzleDb | DrizzleTransaction = this.db,
  ): Promise<number> {
    const [latest] = await manager
      .select({ version: eventStoreTable.version })
      .from(eventStoreTable)
      .where(eq(eventStoreTable.streamId, streamId))
      .orderBy(desc(eventStoreTable.version))
      .limit(1);

    return latest?.version ?? 0;
  }

  async readStream(streamId: string): Promise<StoredDomainEvent[]> {
    const rows = await this.db
      .select()
      .from(eventStoreTable)
      .where(eq(eventStoreTable.streamId, streamId))
      .orderBy(asc(eventStoreTable.version));

    return rows.map((row) => this.toStoredEvent(row));
  }

  async readAfter(globalSeq: string, limit = 100): Promise<StoredDomainEvent[]> {
    const rows = await this.db
      .select()
      .from(eventStoreTable)
      .where(gt(eventStoreTable.globalSeq, BigInt(globalSeq)))
      .orderBy(asc(eventStoreTable.globalSeq))
      .limit(limit);

    return rows.map((row) => this.toStoredEvent(row));
  }

  async checkpoint(projection: string, lastSeq: string): Promise<void> {
    const value = BigInt(lastSeq);

    await this.db
      .insert(projectionCheckpointsTable)
      .values({ projection, lastSeq: value, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: projectionCheckpointsTable.projection,
        set: { lastSeq: value, updatedAt: new Date() },
      });
  }

  async checkpointFor(projection: string): Promise<string> {
    const [row] = await this.db
      .select({ lastSeq: projectionCheckpointsTable.lastSeq })
      .from(projectionCheckpointsTable)
      .where(eq(projectionCheckpointsTable.projection, projection))
      .limit(1);

    return row ? row.lastSeq.toString() : "0";
  }

  private assertActiveTransaction(tx: DrizzleTransaction): void {
    if (typeof (tx as { rollback?: unknown }).rollback !== "function") {
      throw new Error("Event store append must run inside an active transaction");
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "23505"
    );
  }

  private toStoredEvent(row: EventStoreRow): StoredDomainEvent {
    return {
      globalSeq: row.globalSeq.toString(),
      eventId: row.eventId,
      reference: row.reference,
      streamId: row.streamId,
      version: row.version,
      type: row.type,
      aggregateType: row.aggregateType,
      aggregateId: row.aggregateId,
      payload: row.payload,
      metadata: row.metadata,
      occurredAt: row.occurredAt,
      createdAt: row.createdAt,
    };
  }
}
`;

  await writeFile(path.join(eventBackbonePath, 'event-store.service.ts'), eventStoreServiceContent);

  const outboxServiceContent = `import { Inject, Injectable } from "@nestjs/common";
import { DRIZZLE, DrizzleDb } from "@shared/database/drizzle.provider";
import {
  DrizzleTransaction,
  OutboxEventStatus,
  OutboxPublishInput,
} from "./event-backbone.types";
import { OutboxTransactionRequiredError } from "./event-backbone.errors";
import { OutboxEventRow, outboxEventsTable } from "./entities/outbox-event.orm-entity";

@Injectable()
export class OutboxService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async enqueue(
    input: OutboxPublishInput,
    tx: DrizzleTransaction,
  ): Promise<OutboxEventRow> {
    if (typeof (tx as { rollback?: unknown }).rollback !== "function") {
      throw new OutboxTransactionRequiredError();
    }

    const now = new Date();
    const [row] = await tx
      .insert(outboxEventsTable)
      .values({
        id: input.eventId,
        reference: input.reference ?? null,
        eventType: input.type,
        source: input.source,
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        streamId: input.streamId,
        version: input.version,
        subject: input.subject ?? null,
        payload: input.payload,
        metadata: input.metadata ?? {},
        status: OutboxEventStatus.Pending,
        attempts: 0,
        availableAt: now,
        occurredAt: input.occurredAt ?? now,
        publishedAt: null,
        lastError: null,
      })
      .returning();

    return row!;
  }

  async enqueueInTransaction<T>(
    work: (tx: DrizzleTransaction) => Promise<{ result: T; event: OutboxPublishInput }>,
  ): Promise<T> {
    return this.db.transaction(async (tx) => {
      const { result, event } = await work(tx);
      await this.enqueue(event, tx);
      return result;
    });
  }
}
`;

  await writeFile(path.join(eventBackbonePath, 'outbox.service.ts'), outboxServiceContent);

  const noopPublisherContent = `import { Injectable, Logger } from "@nestjs/common";
import { EventBackboneEnvelope, EventBackbonePublisher } from "../event-backbone.types";

@Injectable()
export class NoopEventPublisher implements EventBackbonePublisher {
  private readonly logger = new Logger(NoopEventPublisher.name);

  async publish(envelope: EventBackboneEnvelope): Promise<void> {
    this.logger.debug(
      "Event backbone publish skipped because transport is none: " + envelope.type,
    );
  }
}
`;

  await writeFile(path.join(publishersPath, 'noop-event.publisher.ts'), noopPublisherContent);

  const relayHttpPublisherContent = `import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EVENT_BACKBONE_ENV } from "../event-backbone.constants";
import {
  RelayHttpNonRetryableError,
  RelayHttpRetryableError,
} from "../event-backbone.errors";
import { EventBackboneEnvelope, EventBackbonePublisher } from "../event-backbone.types";

const RELAY_EVENTS_PATH = "/api/v1/events";
const RELAY_AUDIENCE_HEADER = "X-Relay-Audience";
const CORRELATION_HEADER = "X-Correlation-Id";

@Injectable()
export class RelayHttpPublisher implements EventBackbonePublisher {
  constructor(private readonly configService: ConfigService) {}

  async publish(envelope: EventBackboneEnvelope): Promise<void> {
    const relayUrl = this.requireConfig(EVENT_BACKBONE_ENV.relayHttpUrl, "relay URL");
    const machineToken = this.requireConfig(
      EVENT_BACKBONE_ENV.relayServiceCredential,
      "relay machine token",
    );
    const audience = this.requireConfig(EVENT_BACKBONE_ENV.relayAudience, "relay audience");
    const timeoutMs = this.timeoutMs();
    const url = this.joinUrl(relayUrl, RELAY_EVENTS_PATH);

    const headers: Record<string, string> = {
      Authorization: "Bearer " + machineToken,
      [RELAY_AUDIENCE_HEADER]: audience,
      "Content-Type": "application/json",
      "Idempotency-Key": envelope.id,
    };

    const correlationId = envelope.metadata?.correlationId;
    if (typeof correlationId === "string" && correlationId.length > 0) {
      headers[CORRELATION_HEADER] = correlationId;
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          ...envelope,
          reference: envelope.reference || envelope.id,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (this.isTimeout(error)) {
        throw new RelayHttpRetryableError(
          "Relay HTTP request timed out after " + String(timeoutMs) + "ms",
        );
      }

      throw new RelayHttpRetryableError(
        error instanceof Error ? error.message : "Relay HTTP request failed",
      );
    }

    if (response.status >= 200 && response.status < 300) {
      return;
    }

    const body = await response.text().catch(() => "");
    const message =
      "Relay HTTP publish failed with status " +
      String(response.status) +
      (body ? ": " + body.slice(0, 500) : "");

    if (this.isRetryableStatus(response.status)) {
      throw new RelayHttpRetryableError(message, response.status);
    }

    throw new RelayHttpNonRetryableError(message, response.status);
  }

  private requireConfig(key: string, label: string): string {
    const value = this.configService.get<string>(key);
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }

    throw new RelayHttpNonRetryableError("Missing event backbone " + label + " (" + key + ")");
  }

  private timeoutMs(): number {
    const configured = Number(this.configService.get<string>(EVENT_BACKBONE_ENV.relayTimeoutMs));
    return Number.isFinite(configured) && configured >= 1000 ? Math.floor(configured) : 10000;
  }

  private isRetryableStatus(status: number): boolean {
    return status === 408 || status === 425 || status === 429 || status >= 500;
  }

  private isTimeout(error: unknown): boolean {
    return (
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    );
  }

  private joinUrl(baseUrl: string, path: string): string {
    return baseUrl.replace(/\\/+$/, "") + path;
  }
}
`;

  await writeFile(path.join(publishersPath, 'relay-http.publisher.ts'), relayHttpPublisherContent);

  const pulsarPublisherContent = `import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EventBackboneEnvelope, EventBackbonePublisher } from "../event-backbone.types";
import { EVENT_BACKBONE_ENV } from "../event-backbone.constants";

type PulsarModule = typeof import("pulsar-client");
type PulsarClient = import("pulsar-client").Client;
type PulsarProducer = import("pulsar-client").Producer;

@Injectable()
export class PulsarEventPublisher implements EventBackbonePublisher, OnModuleDestroy {
  private readonly logger = new Logger(PulsarEventPublisher.name);
  private pulsar?: PulsarModule;
  private client?: PulsarClient;
  private readonly producers = new Map<string, PulsarProducer>();

  constructor(private readonly configService: ConfigService) {}

  async publish(envelope: EventBackboneEnvelope): Promise<void> {
    const producer = await this.producerFor(envelope);
    await producer.send({
      data: Buffer.from(JSON.stringify(envelope)),
      eventTimestamp: Date.parse(envelope.occurredAt),
      properties: {
        event_id: envelope.id,
        event_type: envelope.type,
        aggregate_type: envelope.aggregateType,
        aggregate_id: envelope.aggregateId,
        reference: envelope.reference ?? "",
      },
    });
  }

  async onModuleDestroy(): Promise<void> {
    for (const producer of this.producers.values()) {
      await producer.close();
    }
    this.producers.clear();
    await this.client?.close();
  }

  private async producerFor(envelope: EventBackboneEnvelope): Promise<PulsarProducer> {
    const topic = this.topicFor(envelope);
    const cached = this.producers.get(topic);
    if (cached) {
      return cached;
    }

    const client = await this.getClient();
    const producer = await client.createProducer({ topic });
    this.producers.set(topic, producer);
    return producer;
  }

  private async getClient(): Promise<PulsarClient> {
    if (this.client) {
      return this.client;
    }

    this.pulsar = await import("pulsar-client");
    const serviceUrl =
      this.configService.get<string>(EVENT_BACKBONE_ENV.pulsarServiceUrl) ??
      "pulsar://localhost:6650";

    this.logger.log("Connecting event backbone to Pulsar at " + serviceUrl);
    this.client = new this.pulsar.Client({ serviceUrl });
    return this.client;
  }

  private topicFor(envelope: EventBackboneEnvelope): string {
    const tenant = this.configService.get<string>(EVENT_BACKBONE_ENV.pulsarTenant) ?? "public";
    const namespace =
      this.configService.get<string>(EVENT_BACKBONE_ENV.pulsarNamespace) ?? "default";
    const prefix = this.configService.get<string>(EVENT_BACKBONE_ENV.pulsarTopicPrefix) ?? "";
    const eventType = envelope.type.replace(/[^a-zA-Z0-9._-]/g, ".").toLowerCase();

    return "persistent://" + tenant + "/" + namespace + "/" + prefix + eventType;
  }
}
`;

  await writeFile(path.join(publishersPath, 'pulsar-event.publisher.ts'), pulsarPublisherContent);

  const relayServiceContent = `import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Interval } from "@nestjs/schedule";
import { eq, sql } from "drizzle-orm";
import { DRIZZLE, DrizzleDb } from "@shared/database/drizzle.provider";
import {
  EVENT_BACKBONE_ENV,
  EVENT_BACKBONE_PUBLISHER,
  EVENT_BACKBONE_TRANSPORT,
} from "./event-backbone.constants";
import type {
  EventBackboneEnvelope,
  EventBackbonePublisher,
} from "./event-backbone.types";
import { OutboxEventStatus } from "./event-backbone.types";
import { outboxEventsTable } from "./entities/outbox-event.orm-entity";

interface ClaimedOutboxRow {
  id: string;
  reference: string | null;
  event_type: string;
  source: string;
  aggregate_type: string;
  aggregate_id: string;
  stream_id: string;
  version: number;
  subject: string | null;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  attempts: number;
  occurred_at: Date | string;
}

@Injectable()
export class OutboxRelayService {
  private readonly logger = new Logger(OutboxRelayService.name);
  private running = false;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly configService: ConfigService,
    @Inject(EVENT_BACKBONE_PUBLISHER)
    private readonly publisher: EventBackbonePublisher,
  ) {}

  @Interval(1000)
  async flush(): Promise<void> {
    if (this.running || !this.enabled()) {
      return;
    }

    this.running = true;
    try {
      const rows = await this.claimBatch();
      for (const row of rows) {
        await this.publishRow(row);
      }
    } finally {
      this.running = false;
    }
  }

  private enabled(): boolean {
    if (!this.booleanEnv(EVENT_BACKBONE_ENV.relayEnabled, true)) {
      return false;
    }

    const transport =
      this.configService.get<string>(EVENT_BACKBONE_ENV.transport) ??
      EVENT_BACKBONE_TRANSPORT.none;

    return transport !== EVENT_BACKBONE_TRANSPORT.none;
  }

  private async claimBatch(): Promise<ClaimedOutboxRow[]> {
    const batchSize = this.integerEnv(EVENT_BACKBONE_ENV.relayBatchSize, 50);
    const maxAttempts = this.integerEnv(EVENT_BACKBONE_ENV.relayMaxAttempts, 10);

    return this.db.transaction(async (tx) => {
      // Raw SQL (not the query builder): this needs FOR UPDATE SKIP LOCKED so
      // concurrent relay instances never claim the same row twice, which the
      // typed query builder has no equivalent for.
      const result = await tx.execute(sql\`
        UPDATE outbox_events
        SET status = \${OutboxEventStatus.Publishing}, attempts = attempts + 1, updated_at = now()
        WHERE id IN (
          SELECT id FROM outbox_events
          WHERE ((status IN (\${OutboxEventStatus.Pending}, \${OutboxEventStatus.Failed}) AND available_at <= now())
            OR (status = \${OutboxEventStatus.Publishing} AND updated_at < now() - interval '5 minutes'))
          AND attempts < \${maxAttempts}
          ORDER BY available_at ASC
          LIMIT \${batchSize}
          FOR UPDATE SKIP LOCKED
        )
        RETURNING *
      \`);

      const rows = Array.isArray(result[0]) ? result[0] : result;
      return rows as unknown as ClaimedOutboxRow[];
    });
  }

  private async publishRow(row: ClaimedOutboxRow): Promise<void> {
    try {
      await this.publisher.publish(this.envelopeFromRow(row));
      await this.db
        .update(outboxEventsTable)
        .set({
          status: OutboxEventStatus.Published,
          publishedAt: new Date(),
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(outboxEventsTable.id, row.id));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const maxAttempts = this.integerEnv(EVENT_BACKBONE_ENV.relayMaxAttempts, 10);
      const nextStatus =
        row.attempts >= maxAttempts ? OutboxEventStatus.Failed : OutboxEventStatus.Pending;
      const delayMs = this.integerEnv(EVENT_BACKBONE_ENV.relayRetryBaseMs, 30000) * row.attempts;

      await this.db
        .update(outboxEventsTable)
        .set({
          status: nextStatus,
          availableAt: new Date(Date.now() + delayMs),
          lastError: message,
          updatedAt: new Date(),
        })
        .where(eq(outboxEventsTable.id, row.id));

      this.logger.warn("Failed to publish outbox event " + row.id + ": " + message);
    }
  }

  private envelopeFromRow(row: ClaimedOutboxRow): EventBackboneEnvelope {
    const occurredAt =
      row.occurred_at instanceof Date ? row.occurred_at.toISOString() : row.occurred_at;
    const metadata = row.metadata ?? {};
    const schemaVersion =
      typeof metadata.schemaVersion === "number" && Number.isFinite(metadata.schemaVersion)
        ? Math.floor(metadata.schemaVersion)
        : 1;

    return {
      id: row.id,
      schemaVersion,
      reference: row.reference ?? undefined,
      type: row.event_type,
      source: row.source,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      streamId: row.stream_id,
      version: row.version,
      subject: row.subject ?? undefined,
      payload: row.payload,
      metadata,
      occurredAt,
    };
  }

  private integerEnv(key: string, fallback: number): number {
    const value = Number(this.configService.get<string>(key));
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
  }

  private booleanEnv(key: string, fallback: boolean): boolean {
    const value = this.configService.get<boolean | string>(key, fallback);
    return value === true || value === "true";
  }
}
`;

  await writeFile(path.join(eventBackbonePath, 'outbox-relay.service.ts'), relayServiceContent);

  const moduleContent = `import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { BusinessReferenceModule } from "../business-references";
import {
  EVENT_BACKBONE_ENV,
  EVENT_BACKBONE_PUBLISHER,
  EVENT_BACKBONE_TRANSPORT,
} from "./event-backbone.constants";
import { EventStoreService } from "./event-store.service";
import { OutboxRelayService } from "./outbox-relay.service";
import { OutboxService } from "./outbox.service";
import { NoopEventPublisher } from "./publishers/noop-event.publisher";
import { PulsarEventPublisher } from "./publishers/pulsar-event.publisher";
import { RelayHttpPublisher } from "./publishers/relay-http.publisher";

// Drizzle needs no TypeOrmModule.forFeature-style registration here — the
// global DRIZZLE provider (from DatabaseModule) is injected directly into
// EventStoreService, OutboxService, and OutboxRelayService above.
@Module({
  imports: [
    ConfigModule,
    BusinessReferenceModule,
    ScheduleModule.forRoot(),
  ],
  providers: [
    EventStoreService,
    OutboxService,
    OutboxRelayService,
    {
      provide: EVENT_BACKBONE_PUBLISHER,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const transport =
          configService.get<string>(EVENT_BACKBONE_ENV.transport) ??
          EVENT_BACKBONE_TRANSPORT.none;

        if (transport === EVENT_BACKBONE_TRANSPORT.pulsar) {
          return new PulsarEventPublisher(configService);
        }

        if (transport === EVENT_BACKBONE_TRANSPORT.relayHttp) {
          return new RelayHttpPublisher(configService);
        }

        return new NoopEventPublisher();
      },
    },
  ],
  exports: [EventStoreService, OutboxService, EVENT_BACKBONE_PUBLISHER],
})
export class EventBackboneModule {}
`;

  await writeFile(path.join(eventBackbonePath, 'event-backbone.module.ts'), moduleContent);

  const indexContent = `export * from "./event-backbone.constants";
export * from "./event-backbone.env";
export * from "./event-backbone.errors";
export * from "./event-backbone.types";
export * from "./event-store.service";
export * from "./outbox.service";
export * from "./event-backbone.module";
export * from "./entities/event-store.orm-entity";
export * from "./entities/outbox-event.orm-entity";
export * from "./entities/projection-checkpoint.orm-entity";
`;

  await writeFile(path.join(eventBackbonePath, 'index.ts'), indexContent);

  // Drizzle projects don't get a hand-written migration class: the pgTable
  // schema files under entities/ are already the source of truth, and
  // `drizzle-kit generate` diffs them into real SQL migrations. Make sure
  // they're covered by the project's drizzle.config.ts schema glob, then
  // print the same generate/migrate guidance the core scaffolder uses.
  console.log(chalk.green('  ✓ Business reference sidecar recipe installed'));
  console.log(chalk.green('  ✓ Joi environment schema fragment'));
  console.log(chalk.green('  ✓ Postgres event store entities and service'));
  console.log(chalk.green('  ✓ Transactional outbox service and relay'));
  console.log(chalk.green('  ✓ Relay HTTP and Pulsar publishers with transport selection'));
  console.log(
    chalk.green('  ✓ Drizzle schema for event_store, outbox_events, projection_checkpoints'),
  );
  console.log(
    chalk.yellow(
      '  ⚠ Make sure the schema glob in drizzle.config.ts covers src/shared/event-backbone/entities/*.orm-entity.ts',
    ),
  );
  console.log(
    chalk.cyan(
      '  → Run npx drizzle-kit generate then npx drizzle-kit migrate to create the SQL migration for these tables.',
    ),
  );
}
