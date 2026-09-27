#!/usr/bin/env node
/**
 * Creates the schema, tables and indexes the studio needs - the same DDL
 * `ensureSchema()` in `src/lib/db.ts` runs, lifted out so it can happen once,
 * at deploy time, instead of on every serverless cold start.
 *
 * Usage:
 *   npm run db:setup
 *
 * Then set `DB_SCHEMA_READY=1` in the deployment's environment so the app stops
 * repeating it. Re-run this after any change to the table definitions.
 *
 * Reads connection settings from .env.local (if present) the same way the app
 * does - DB_ENV=local plus DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD/DB_SSL,
 * or a connection string (DATABASE_URL / POSTGRES_URL / PRISMA_DATABASE_URL)
 * otherwise, optionally scoped to DB_SCHEMA. Every statement is
 * `IF NOT EXISTS`, so this is safe to re-run and never drops anything.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, "..");

/** Minimal .env parser - KEY=VALUE per line, no interpolation. Never overrides an already-set var. */
async function loadEnvLocal() {
  let text;
  try {
    text = await fs.readFile(path.join(ROOT_DIR, ".env.local"), "utf8");
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function env(name) {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function buildPoolConfig() {
  if ((env("DB_ENV") ?? "").toLowerCase() === "local") {
    const host = env("DB_HOST");
    const database = env("DB_NAME");
    const user = env("DB_USER");
    if (!host || !database || !user) {
      throw new Error("DB_ENV=local requires DB_HOST, DB_NAME and DB_USER to be set.");
    }
    return {
      host,
      port: Number(env("DB_PORT") ?? "5432"),
      database,
      user,
      password: env("DB_PASSWORD"),
      ssl: env("DB_SSL") === "true" ? { rejectUnauthorized: false } : undefined,
    };
  }

  const connectionString = env("DATABASE_URL") ?? env("POSTGRES_URL") ?? env("PRISMA_DATABASE_URL");
  if (!connectionString) {
    throw new Error(
      "No database configured. Set DATABASE_URL (or POSTGRES_URL / PRISMA_DATABASE_URL) in " +
        ".env.local, or DB_ENV=local plus DB_HOST/DB_NAME/DB_USER/DB_PASSWORD.",
    );
  }
  const ssl = /sslmode=disable/i.test(connectionString) ? undefined : { rejectUnauthorized: false };
  return { connectionString, ssl };
}

const SCHEMA_NAME_PATTERN = /^[a-z_][a-z0-9_]*$/i;

function resolveSchemaName() {
  const raw = env("DB_SCHEMA");
  if (!raw) return "public";
  if (!SCHEMA_NAME_PATTERN.test(raw)) {
    throw new Error(`DB_SCHEMA "${raw}" is not a valid Postgres identifier.`);
  }
  return raw;
}

/** Keep in step with `schemaStatements()` in src/lib/db.ts. */
function schemaStatements(schema) {
  const statements = [];
  if (schema !== "public") statements.push(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  statements.push(
    `CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      data JSONB NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS endpoints (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      data JSONB NOT NULL,
      UNIQUE (project_id, method, path)
    )`,
    `CREATE INDEX IF NOT EXISTS endpoints_project_id_idx ON endpoints (project_id)`,
    `CREATE TABLE IF NOT EXISTS studio_users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      data JSONB NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS request_logs (
      id TEXT PRIMARY KEY,
      ts TIMESTAMPTZ NOT NULL,
      project_id TEXT,
      endpoint_id TEXT,
      outcome TEXT,
      data JSONB NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS request_logs_ts_idx ON request_logs (ts DESC)`,
    `CREATE INDEX IF NOT EXISTS request_logs_project_id_idx ON request_logs (project_id)`,
    `CREATE INDEX IF NOT EXISTS request_logs_endpoint_id_idx ON request_logs (endpoint_id)`,
  );
  return statements;
}

async function main() {
  await loadEnvLocal();

  const schema = resolveSchemaName();
  const pool = new Pool(buildPoolConfig());
  const client = await pool.connect();

  try {
    if (schema !== "public") {
      await client.query(`SET search_path TO "${schema}", public`);
    }
    // One message, one round trip - see `schemaSql()` in src/lib/db.ts.
    await client.query(`${schemaStatements(schema).join(";\n")};`);

    const { rows } = await client.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = $1 AND table_name = ANY($2)
        ORDER BY table_name`,
      [schema, ["projects", "endpoints", "studio_users", "request_logs"]],
    );
    console.log(`Schema "${schema}" ready: ${rows.map((row) => row.table_name).join(", ")}`);
    console.log("Set DB_SCHEMA_READY=1 in the deployment environment to skip this at runtime.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
