/**
 * Postgres connection settings for TypeORM.
 *
 * Ported from the Next.js studio's `src/lib/db.ts` - same env vars, same
 * connection-target rules, same pooling caution - so the two apps (and
 * whoever operates them) share one mental model even though this one talks
 * to the database through TypeORM instead of a raw `pg.Pool`.
 */
import type { TypeOrmModuleOptions } from "@nestjs/typeorm";
import type { ConfigService } from "@nestjs/config";

import { EndpointEntity } from "./entities/endpoint.entity";
import { ProjectEntity } from "./entities/project.entity";
import { RequestLogEntity } from "./entities/request-log.entity";
import { StudioUserEntity } from "./entities/studio-user.entity";

const ENTITIES = [ProjectEntity, EndpointEntity, StudioUserEntity, RequestLogEntity];

function env(config: ConfigService, name: string): string | undefined {
  const value = config.get<string>(name);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * How many connections one pool holds open.
 *
 * This backend is meant to run as a long-lived Node process (unlike the
 * Next.js studio it replaces the API of, which paid per-cold-start Postgres
 * handshakes on Vercel) - so a normal-sized pool is the right default
 * everywhere. If it is ever deployed somewhere that spins up many short-lived
 * instances (serverless), the same risk applies as before: a pool per
 * instance can exhaust the database's connection limit. `DB_POOL_MAX`
 * overrides the default in either direction.
 */
function poolMax(config: ConfigService): number {
  const override = Number(env(config, "DB_POOL_MAX"));
  if (Number.isFinite(override) && override > 0) return Math.floor(override);
  return env(config, "VERCEL") ? 1 : 10;
}

const SCHEMA_NAME_PATTERN = /^[a-z_][a-z0-9_]*$/i;

/** The Postgres schema every studio table lives in - `public` unless overridden. */
function resolveSchemaName(config: ConfigService): string {
  const raw = env(config, "DB_SCHEMA");
  if (!raw) return "public";
  if (!SCHEMA_NAME_PATTERN.test(raw)) {
    throw new Error(`DB_SCHEMA "${raw}" is not a valid Postgres identifier.`);
  }
  return raw;
}

/**
 * `-c search_path=...` is a libpq startup parameter: node-postgres forwards
 * `options` from the pool config straight into the connection's startup
 * packet, so every connection in the pool - whether TypeORM's query builder
 * or a raw `dataSource.query(...)` call - sees the right `search_path` from
 * its very first query. This is deliberately not done via TypeORM's `schema`
 * DataSourceOption instead: that only qualifies SQL TypeORM itself generates,
 * and several services here (the aggregate queries in `LogsService` and
 * `ProjectsService`) run hand-written SQL that a connection-level
 * `search_path` covers uniformly and a query-builder-level setting would not.
 */
function searchPathOptions(schema: string): string | undefined {
  return schema === "public" ? undefined : `-c search_path="${schema}",public`;
}

export function buildTypeOrmOptions(config: ConfigService): TypeOrmModuleOptions {
  const schema = resolveSchemaName(config);
  const options = searchPathOptions(schema);
  const max = poolMax(config);

  if ((env(config, "DB_ENV") ?? "").toLowerCase() === "local") {
    const host = env(config, "DB_HOST");
    const database = env(config, "DB_NAME");
    const user = env(config, "DB_USER");
    if (!host || !database || !user) {
      throw new Error(
        "DB_ENV=local requires DB_HOST, DB_NAME and DB_USER to be set (see .env.example).",
      );
    }
    return {
      type: "postgres",
      host,
      port: Number(env(config, "DB_PORT") ?? "5432"),
      database,
      username: user,
      password: env(config, "DB_PASSWORD"),
      ssl: env(config, "DB_SSL") === "true" ? { rejectUnauthorized: false } : undefined,
      schema,
      extra: { max, keepAlive: true, options },
      entities: ENTITIES,
      synchronize: false,
      logging: env(config, "DB_LOG") === "true",
    };
  }

  const connectionString =
    env(config, "DATABASE_URL") ?? env(config, "POSTGRES_URL") ?? env(config, "PRISMA_DATABASE_URL");
  if (!connectionString) {
    throw new Error(
      "No database configured. Set DATABASE_URL (or POSTGRES_URL / PRISMA_DATABASE_URL), " +
        "or set DB_ENV=local plus DB_HOST/DB_NAME/DB_USER/DB_PASSWORD (see .env.example).",
    );
  }
  // Hosted Postgres (Neon, Supabase, Prisma Postgres, RDS, ...) requires TLS;
  // opt out with `?sslmode=disable` in the connection string otherwise.
  const ssl = /sslmode=disable/i.test(connectionString) ? undefined : { rejectUnauthorized: false };
  return {
    type: "postgres",
    url: connectionString,
    ssl,
    schema,
    extra: { max, keepAlive: true, options },
    entities: ENTITIES,
    synchronize: false,
    logging: env(config, "DB_LOG") === "true",
  };
}
