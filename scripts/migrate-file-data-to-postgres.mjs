#!/usr/bin/env node
/**
 * One-time migration: copies the legacy `data/*.json` files (projects,
 * endpoints, users) into Postgres, so nothing registered before the move to
 * a database is lost.
 *
 * Usage:
 *   npm run migrate:data
 *
 * Reads connection settings from .env.local (if present) the same way the
 * app does - DB_ENV=local plus DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD/
 * DB_SSL, or a connection string (DATABASE_URL / POSTGRES_URL /
 * PRISMA_DATABASE_URL) otherwise, optionally scoped to DB_SCHEMA. Safe to
 * re-run - existing rows are upserted, not duplicated. Reads json files from
 * MOCK_DATA_DIR if set (the old file-storage env var), else `./data`.
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

async function readJsonFiles(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
    .map((entry) => path.join(dir, entry.name));

  const out = [];
  for (const file of files) {
    try {
      out.push(JSON.parse(await fs.readFile(file, "utf8")));
    } catch (error) {
      console.warn(`skipping ${file}: ${error.message}`);
    }
  }
  return out;
}

async function main() {
  await loadEnvLocal();

  const DATA_DIR = process.env.MOCK_DATA_DIR
    ? path.resolve(process.env.MOCK_DATA_DIR)
    : path.join(ROOT_DIR, "data");

  const pool = new Pool(buildPoolConfig());
  const schema = resolveSchemaName();

  // Must be attached before the first query - it fires once per physical
  // connection, before that connection is used, so every unqualified
  // CREATE/INSERT below resolves against `schema` instead of `public`.
  if (schema !== "public") {
    pool.on("connect", (client) => {
      client.query(`SET search_path TO "${schema}", public`).catch((error) => {
        console.error(`Failed to set search_path to "${schema}":`, error);
      });
    });
  }

  for (const statement of schemaStatements(schema)) {
    await pool.query(statement);
  }

  const projects = await readJsonFiles(path.join(DATA_DIR, "projects"));
  let projectCount = 0;
  for (const project of projects) {
    if (!project?.id || !project?.slug) continue;
    await pool.query(
      `INSERT INTO projects (id, slug, data) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, data = EXCLUDED.data`,
      [project.id, project.slug, JSON.stringify(project)],
    );
    projectCount++;
  }

  const endpoints = await readJsonFiles(path.join(DATA_DIR, "endpoints"));
  let endpointCount = 0;
  for (const endpoint of endpoints) {
    if (!endpoint?.id || !endpoint?.projectId) continue;
    await pool.query(
      `INSERT INTO endpoints (id, project_id, method, path, data) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET
         project_id = EXCLUDED.project_id, method = EXCLUDED.method,
         path = EXCLUDED.path, data = EXCLUDED.data`,
      [endpoint.id, endpoint.projectId, endpoint.method, endpoint.path, JSON.stringify(endpoint)],
    );
    endpointCount++;
  }

  let userCount = 0;
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, "users.json"), "utf8");
    const users = JSON.parse(raw);
    if (Array.isArray(users)) {
      for (const user of users) {
        if (!user?.id || !user?.username) continue;
        await pool.query(
          `INSERT INTO studio_users (id, username, data) VALUES ($1, $2, $3)
           ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username, data = EXCLUDED.data`,
          [user.id, user.username, JSON.stringify(user)],
        );
        userCount++;
      }
    }
  } catch {
    // no users.json - fine, the app seeds an admin on first run instead.
  }

  await pool.end();
  console.log(
    `Migrated ${projectCount} project(s), ${endpointCount} endpoint(s), ${userCount} user(s) ` +
      `from ${DATA_DIR} into schema "${schema}".`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
