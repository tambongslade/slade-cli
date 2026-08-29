# Slade CLI

**An opinionated CLI for pragmatic Domain-Driven Design with NestJS, Drizzle, and PostgreSQL**

Stop writing boilerplate. Start building business logic.

Generate production-ready, security-hardened NestJS code following proven DDD/CQRS patterns with consistent structure and immutable architecture principles.

## What's New in v3.2

- **Security-Hardened Generation**: 25 security iterations following OWASP Top 10
- **Enterprise Patterns**: Circuit breaker, distributed tracing, feature flags
- **Advanced Caching**: Cache-aside, write-through, invalidation strategies
- **Observability**: OpenTelemetry tracing, Prometheus metrics, Grafana dashboards
- **Database Optimization**: DataLoader, query analysis, connection pooling
- **Kubernetes-Ready**: Health probes, graceful shutdown, liveness/readiness
- **GraphQL Subscriptions**: Real-time with PubSub and connection management

## Installation

```bash
npm install -g slade-cli
```

## Quick Start

```bash
# Initialize a new project
slade init my-project

# Generate a financial-safe aggregate without a generic DELETE operation
slade scaffold Invoice -m billing --fields "amount:money tenantId:uuid:serverOwned" --no-delete

# Apply authentication recipe
slade recipe auth-jwt --install-deps

# Set up security patterns
slade security-patterns

# Add observability
slade observability
```

## Commands

### Core Commands

| Command | Description |
|---------|-------------|
| `slade init <name>` | Initialize new NestJS project with DDD structure |
| `slade scaffold <entity> -m <module>` | Generate a complete aggregate stack |
| `slade generate <type> <name> -m <module>` | Generate individual components |
| `slade recipe [name]` | Apply common patterns (auth, caching, etc.) |
| `slade shared` | Generate shared utilities and base classes |

```bash
slade generate dto Product -m inventory --kind create
```

### Enterprise Commands

| Command | Description |
|---------|-------------|
| `slade security-patterns` | RBAC, encryption, OWASP middleware, JWT security |
| `slade circuit-breaker` | Resilience patterns (retry, timeout, fallback) |
| `slade observability` | OpenTelemetry distributed tracing |
| `slade feature-flags` | Feature flags with A/B testing support |
| `slade caching-advanced` | Multi-layer caching strategies |
| `slade db-optimization` | DataLoader, query analyzer, connection pooling |
| `slade database-seeding` | Seed runner with fixture factories |
| `slade health-probes` | Kubernetes liveness/readiness/startup probes |
| `slade metrics-prometheus` | Prometheus metrics with Grafana dashboard |
| `slade graphql-subscriptions` | Real-time GraphQL with PubSub |

### Utility Commands

| Command | Description |
|---------|-------------|
| `slade update` | Update CLI to latest version |
| `slade update-deps` | Update project dependencies |

## Field-Aware Generation

Generate complete typed entities, DTOs, and migrations:

```bash
slade scaffold Product -m inventory --fields "name:string price:money:optional sku:string:unique"
```

**Field Format:** `name:type:modifier1:modifier2`

| Types | Modifiers |
|-------|-----------|
| `string`, `text` | `optional` |
| `number`, `int`, `float`, `decimal` | `unique` |
| `money` (exact decimal-backed TypeScript string) | `serverOwned` (`internal` alias) |
| `boolean` | `relation` |
| `date`, `datetime`, `timestamp` | `OneToOne`, `OneToMany`, `ManyToOne`, `ManyToMany` |
| `uuid`, `json`, `enum` | |

Use `money` for financial values that must not pass through JavaScript floating-point
numbers. It generates `string` in domain, Drizzle, request, and response types,
decimal-string validation and OpenAPI metadata, plus a Drizzle `numeric(..., { mode: "string" })`
column (Prisma: `Decimal`). Existing `decimal` fields remain TypeScript `number` for
compatibility, backed by Drizzle's `numeric(..., { mode: "number" })`.

Use `serverOwned` for fields populated from trusted application context rather than
the request body:

```bash
slade scaffold Invoice -m billing \
  --fields "amount:money tenantId:uuid:serverOwned bookId:uuid:serverOwned"
```

Server-owned fields remain in domain, persistence, mapper, and response generation,
but are omitted from create/update request DTOs and request mass-assignment. The
generated create command accepts a second typed `serverOwnedFields` argument and
fails closed until the controller/application layer supplies it from authenticated
context.

For an aggregate with no generic deletion capability:

```bash
slade scaffold LedgerEntry -m ledger --fields "amount:money" --no-delete
# Equivalent project-wide default: features.delete = false in .dddrc.json
```

**Relations:**
```bash
# ManyToOne relation
slade scaffold Order -m orders --fields "customer:relation:Customer:ManyToOne"

# OneToMany relation
slade scaffold Customer -m customers --fields "orders:relation:Order:OneToMany:customer"
```

## Security Features

The CLI generates security-hardened code following OWASP Top 10:

### Generated Security Patterns

```bash
slade security-patterns
```

Creates:
- **Encryption Service** - AES-256-GCM with PBKDF2 (600,000 iterations)
- **RBAC/ABAC Service** - Role and attribute-based access control
- **OWASP Middleware** - XSS, SQL injection, path traversal prevention
- **JWT Security** - Algorithm confusion prevention, claim validation
- **CORS Configuration** - Strict origin validation
- **Cookie Security** - HttpOnly, Secure, SameSite flags
- **Security Headers** - CSP, HSTS, X-Frame-Options, Permissions-Policy
- **Input Sanitizer** - HTML, shell, filename, URL sanitization
- **Secret Vault** - Encrypted secret storage with rotation

### Built-in Protections

- Path traversal prevention in all file operations
- Input validation with MaxLength on all string fields
- Sensitive data masking in logs (credit cards, SSN, tokens)
- Secure error handling (hides internals in production)
- Brute force detection with IP blocking
- CSRF token validation

## Recipes

```bash
# List available recipes
slade recipe

# Apply with dependency installation
slade recipe auth-jwt --install-deps
slade recipe event-backbone --install-deps
slade recipe oidc-dashboard --install-deps
slade recipe platform-service-access-request-context
```

| Recipe | Description |
|--------|-------------|
| `auth-jwt` | JWT authentication with guards and decorators |
| `pagination` | Shared pagination DTOs and utilities |
| `soft-delete` | Base entity and repository with soft delete |
| `audit-log` | Entity change tracking with sensitive data masking |
| `caching` | Redis caching with decorators |
| `event-backbone` | Postgres event store/outbox source of truth with Pulsar transport |
| `business-reference-identifiers` | Human-readable sidecar references beside canonical IDs |
| `platform-service-runtime` | Service manifest, capabilities, actions, events, dependencies, and health contract |
| `platform-service-access-request-context` | Fail-closed Service Access lease introspection before route-specific PARC authorization |
| `banklink-connector-contract` | BankLink NestJS control-plane and Go sidecar connector boundary contract |
| `oidc-dashboard` | OIDC broker integration for internal dashboards and admin APIs |

## Generated Structure

```
src/
├── modules/
│   └── [module-name]/
│       ├── [module].module.ts
│       ├── application/
│       │   ├── commands/           # CQRS commands
│       │   ├── queries/            # CQRS queries (paginated)
│       │   ├── controllers/        # REST endpoints
│       │   └── dto/
│       │       ├── requests/       # Input DTOs with validation
│       │       └── responses/      # Output DTOs
│       └── domain/
│           ├── entities/           # Domain entities
│           ├── events/             # Domain events
│           ├── services/           # Domain services
│           └── usecases/           # Business logic
│       └── infrastructure/
│           ├── repositories/       # Data access (Drizzle queries)
│           ├── orm-entities/       # Drizzle pgTable schema definitions
│           └── mappers/            # Entity mapping
├── shared/
│   ├── database/                   # Drizzle connection provider + DatabaseModule
│   ├── security/                   # Security services
│   ├── observability/              # Tracing, metrics
│   ├── resilience/                 # Circuit breaker, retry
│   └── infrastructure/             # Base classes, utilities
└── drizzle.config.ts               # drizzle-kit migration config
```

## Configuration

Create `.dddrc.json` in your project root:

```json
{
  "$schema": "https://unpkg.com/slade-cli/ddd.schema.json",
  "orm": "drizzle",
  "database": "postgres",
  "naming": {
    "table": "snake_case",
    "dto": "camelCase",
    "file": "kebab-case"
  },
  "features": {
    "swagger": true,
    "pagination": true,
    "delete": true,
    "softDelete": true,
    "hardDelete": false,
    "timestamps": true,
    "tests": false,
    "events": false
  },
  "paths": {
    "modules": "src/modules",
    "migrations": "src/migrations",
    "shared": "src/shared"
  }
}
```

`features.delete` controls whether aggregate scaffolds emit the generic DELETE
controller route, delete command/use case, and repository `delete`/`hardDelete`
surface. It defaults to `true` for compatibility. Set it to `false`, or pass
`--no-delete` to `slade scaffold`/`slade generate all`, for a non-destructive aggregate
scaffold. This does not remove existing generated files and does not disable
soft-delete columns or active-row filtering.

`features.softDelete` controls the generated domain field, ORM column or Prisma
field, active-row filters, and repository delete behavior. When it is `false`,
none of the generated code references `deletedAt`/`deleted_at` and the ordinary
`delete` method performs the ORM's normal delete operation.

`features.hardDelete` is disabled by default. Set it to `true` only when a
soft-delete repository must expose a separately named `hardDelete` compatibility
helper. It never changes the ordinary `delete` method, and it is omitted when
`softDelete` is disabled because ordinary deletion is already physical.

## Real-World Examples

### E-commerce with Security

```bash
slade init ecommerce-api
cd ecommerce-api

# Core security
slade security-patterns
slade recipe auth-jwt --install-deps

# Domain modules
slade scaffold Product -m inventory --fields "name:string price:money sku:string:unique stock:int"
slade scaffold Order -m orders --fields "total:money status:enum:pending,paid,shipped customerId:uuid"
slade scaffold Customer -m customers --fields "email:string:unique name:string"

# Enterprise features
slade circuit-breaker
slade observability
slade caching-advanced
```

### Microservice with Observability

```bash
slade init payment-service
cd payment-service

# Infrastructure
slade security-patterns
slade observability
slade metrics-prometheus
slade health-probes

# Domain
slade scaffold Transaction -m payments --fields "amount:money currency:string status:enum:pending,completed,failed"
slade circuit-breaker
```

### GraphQL API with Real-time

```bash
slade init realtime-api
cd realtime-api

slade scaffold Message -m chat --fields "content:text senderId:uuid roomId:uuid"
slade graphql-subscriptions
slade caching-advanced
```

## AI Integration

The CLI generates a `CLAUDE.md` file with project context for AI assistants:
- Project structure documentation
- CLI command reference
- Naming conventions
- Architecture rules
- Security patterns
- Common patterns

## API Conventions

All generated APIs follow RESTful conventions with security:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/entities` | List with pagination |
| GET | `/entities/:id` | Get single entity |
| POST | `/entities` | Create new entity |
| PUT | `/entities/:id` | Update entity |
| DELETE | `/entities/:id` | Soft delete entity (omitted with `--no-delete`) |

### Pagination

```
GET /entities?page=1&limit=10&sortBy=createdAt&sortOrder=DESC
```

Response:
```json
{
  "items": [...],
  "meta": {
    "total": 100,
    "page": 1,
    "limit": 10,
    "totalPages": 10,
    "hasNextPage": true,
    "hasPreviousPage": false
  }
}
```

## Philosophy

### Security First
- OWASP Top 10 compliance built-in
- Secure defaults, not optional add-ons
- Production-ready from day one

### Immutable Architecture
- Each generated component remains unchanged after creation
- New requirements create new use cases, never modify existing ones
- Predictable structure enables instant developer onboarding

### Opinionated by Design
- Zero configuration fatigue - one way to do things
- Consistent naming across all projects
- Battle-tested patterns from enterprise applications

### CQRS Compliance
- Commands for writes, queries for reads
- Clear separation of concerns
- Testable by default

## Contributing

```bash
git clone https://github.com/tambongslade/slade-cli
cd slade-cli
npm install
npm run build
npm link

# Test locally
slade scaffold Test -m test-module --fields "name:string"
```

## License

MIT
