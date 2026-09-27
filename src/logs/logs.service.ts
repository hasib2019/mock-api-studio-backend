/**
 * Request log for the mock runtime - ported from the original Next.js
 * studio's `src/lib/logs.ts`, including the SQL-side aggregation in
 * `stats()` (a later optimisation on the original: it counts in Postgres via
 * `GROUP BY` + `FILTER` instead of pulling every row's full JSONB payload -
 * request/response bodies included - across the wire just to count it).
 */
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

import { RequestLogEntity } from "../database/entities/request-log.entity";
import { withLock } from "../common/lock";
import { newId } from "../common/ids";
import type { LogOutcome, RequestLog } from "../common/types";

const LOGS_LOCK = "logs:requests";
/** Bodies larger than this are stored as a stub so the log table stays small. */
const MAX_BODY_BYTES = 20 * 1024;
const OUTCOMES: LogOutcome[] = ["matched", "validation_failed", "auth_failed", "not_found", "disabled"];

export interface LogFilter {
  projectId?: string;
  endpointId?: string;
  outcome?: string;
  limit?: number;
}

export interface LogStats {
  total: number;
  last24h: number;
  failed24h: number;
  byOutcome: Record<string, number>;
}

function isLog(value: unknown): value is RequestLog {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as { id?: unknown; ts?: unknown };
  return typeof record.id === "string" && typeof record.ts === "string";
}

/** Oversized payloads are replaced by `{ truncated: true, bytes }`. */
function limitBody(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch {
    return { truncated: true, bytes: 0 };
  }
  if (json === undefined) return null;
  const bytes = Buffer.byteLength(json, "utf8");
  return bytes > MAX_BODY_BYTES ? { truncated: true, bytes } : value;
}

function stringMap(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") out[key] = entry;
  }
  return out;
}

@Injectable()
export class LogsService {
  constructor(
    @InjectRepository(RequestLogEntity) private readonly repo: Repository<RequestLogEntity>,
    private readonly config: ConfigService,
  ) {}

  /** How many request logs to keep (oldest pruned first). */
  private retention(): number {
    const raw = Number(this.config.get<string>("MOCK_LOG_RETENTION") ?? 500);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 500;
  }

  private normalizeEntry(entry: RequestLog): RequestLog {
    return {
      ...entry,
      id: typeof entry.id === "string" && entry.id ? entry.id : newId("log"),
      ts: typeof entry.ts === "string" && entry.ts ? entry.ts : new Date().toISOString(),
      requestHeaders: stringMap(entry.requestHeaders),
      requestQuery: stringMap(entry.requestQuery),
      requestBody: limitBody(entry.requestBody),
      responseBody: limitBody(entry.responseBody),
      issues: Array.isArray(entry.issues) ? entry.issues : [],
    };
  }

  /**
   * Appends one entry and prunes anything past the retention window. Logging
   * must never break a mock response, so every error (lock contention, a
   * dropped connection, ...) is swallowed.
   */
  async appendLog(entry: RequestLog): Promise<void> {
    try {
      await withLock(LOGS_LOCK, async () => {
        const normalized = this.normalizeEntry(entry);
        await this.repo.insert({
          id: normalized.id,
          ts: new Date(normalized.ts),
          projectId: normalized.projectId ?? null,
          endpointId: normalized.endpointId ?? null,
          outcome: normalized.outcome ?? null,
          data: normalized,
        });
        await this.repo.manager.query(
          `DELETE FROM request_logs WHERE id IN (
             SELECT id FROM request_logs ORDER BY ts DESC OFFSET $1
           )`,
          [this.retention()],
        );
      });
    } catch {
      /* logging is best effort */
    }
  }

  async listLogs(filter: LogFilter = {}): Promise<RequestLog[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter.projectId) {
      params.push(filter.projectId);
      clauses.push(`project_id = $${params.length}`);
    }
    if (filter.endpointId) {
      params.push(filter.endpointId);
      clauses.push(`endpoint_id = $${params.length}`);
    }
    if (filter.outcome) {
      params.push(filter.outcome);
      clauses.push(`outcome = $${params.length}`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

    let limitClause = "";
    if (typeof filter.limit === "number" && Number.isFinite(filter.limit) && filter.limit > 0) {
      params.push(Math.floor(filter.limit));
      limitClause = `LIMIT $${params.length}`;
    }

    const rows = await this.repo.manager.query<Array<{ data: unknown }>>(
      `SELECT data FROM request_logs ${where} ORDER BY ts DESC ${limitClause}`,
      params,
    );
    return rows.map((row) => row.data).filter(isLog);
  }

  /** Removes matching entries (everything when no filter is given); returns how many went. */
  async clearLogs(filter: { projectId?: string; endpointId?: string } = {}): Promise<number> {
    return withLock(LOGS_LOCK, async () => {
      const clauses: string[] = [];
      const params: unknown[] = [];
      if (filter.projectId) {
        params.push(filter.projectId);
        clauses.push(`project_id = $${params.length}`);
      }
      if (filter.endpointId) {
        params.push(filter.endpointId);
        clauses.push(`endpoint_id = $${params.length}`);
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

      const rows = await this.repo.manager.query<Array<{ id: string }>>(
        `DELETE FROM request_logs ${where} RETURNING id`,
        params,
      );
      return rows.length;
    });
  }

  /**
   * Counted by Postgres, not by pulling the table across the wire - see the
   * file header. The `outcome` column carries what the JSONB's `outcome`
   * does, and is indexed.
   */
  async stats(): Promise<LogStats> {
    const rows = await this.repo.manager.query<Array<{ outcome: string; total: number; recent: number }>>(
      `SELECT
         COALESCE(outcome, 'matched') AS outcome,
         count(*)::int AS total,
         count(*) FILTER (WHERE ts >= now() - interval '24 hours')::int AS recent
       FROM request_logs
       GROUP BY 1`,
    );

    const byOutcome: Record<string, number> = {};
    for (const outcome of OUTCOMES) byOutcome[outcome] = 0;

    let total = 0;
    let last24h = 0;
    let failed24h = 0;

    for (const row of rows) {
      byOutcome[row.outcome] = (byOutcome[row.outcome] ?? 0) + Number(row.total);
      total += Number(row.total);
      last24h += Number(row.recent);
      if (row.outcome !== "matched") failed24h += Number(row.recent);
    }

    return { total, last24h, failed24h, byOutcome };
  }
}
