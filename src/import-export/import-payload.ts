/**
 * Rebuilding an endpoint definition from an uploaded import file - ported
 * unchanged (pure, no database access) from the original Next.js studio's
 * `src/app/api/admin/import/route.ts`. An uploaded file is untrusted input;
 * every row gets a fresh id via `new*()` from `../common/defaults`.
 */
import {
  defaultAuthError,
  defaultValidationError,
  newCondition,
  newEndpoint,
  newField,
  newRule,
  newScenario,
} from "../common/defaults";
import { isRecord } from "../common/http";
import { normalizePath } from "../common/ids";
import {
  AUTH_TYPES,
  CONDITION_OPERATORS,
  CONDITION_SOURCES,
  CONTENT_TYPES,
  FIELD_TYPES,
  HTTP_METHODS,
  RULE_IDS,
} from "../common/types";
import type {
  AuthSpec,
  Condition,
  EndpointDef,
  ErrorTemplate,
  FieldDef,
  RequestSpec,
  ResponseScenario,
  RuleId,
  ValidationRule,
} from "../common/types";

/* ------------------------------------------------------------------ *
 * Narrowing helpers
 * ------------------------------------------------------------------ */

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function optionalStr(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function int(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function oneOf<T extends string>(allowed: readonly T[], value: unknown, fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

export function headerMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") out[key] = entry;
  }
  return out;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringList(value: unknown): string[] {
  return array(value)
    .map((entry) => (typeof entry === "string" ? entry : ""))
    .filter((entry) => entry !== "");
}

/* ------------------------------------------------------------------ *
 * Rebuilding the definition - every row gets a fresh id
 * ------------------------------------------------------------------ */

function ruleIdOf(value: unknown): RuleId | null {
  return typeof value === "string" && (RULE_IDS as readonly string[]).includes(value)
    ? (value as RuleId)
    : null;
}

function ruleValue(value: unknown): ValidationRule["value"] {
  if (Array.isArray(value)) return value.map((entry) => String(entry));
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return value;
  }
  return undefined;
}

function ruleValue2(value: unknown): ValidationRule["value2"] {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return value;
  }
  return undefined;
}

function toRules(value: unknown): ValidationRule[] {
  const out: ValidationRule[] = [];
  for (const raw of array(value)) {
    if (!isRecord(raw)) continue;
    const id = ruleIdOf(raw.rule);
    if (!id) continue;
    out.push({
      ...newRule(id, ruleValue(raw.value)),
      value2: ruleValue2(raw.value2),
      message: optionalStr(raw.message),
      enabled: bool(raw.enabled, true),
    });
  }
  return out;
}

function toFields(value: unknown): FieldDef[] {
  const out: FieldDef[] = [];
  for (const raw of array(value)) {
    if (!isRecord(raw)) continue;
    const name = str(raw.name).trim();
    if (!name) continue;
    const type = oneOf(FIELD_TYPES, raw.type, "string");
    out.push(
      newField({
        name,
        label: optionalStr(raw.label),
        type,
        required: bool(raw.required, false),
        description: optionalStr(raw.description),
        example: raw.example,
        defaultValue: raw.defaultValue,
        rules: toRules(raw.rules),
        children: toFields(raw.children),
        itemType: type === "array" ? oneOf(FIELD_TYPES, raw.itemType, "string") : undefined,
      }),
    );
  }
  return out;
}

function toRequestSpec(value: unknown): RequestSpec {
  const raw = isRecord(value) ? value : {};
  return {
    contentType: oneOf(CONTENT_TYPES, raw.contentType, "application/json"),
    body: toFields(raw.body),
    query: toFields(raw.query),
    headers: toFields(raw.headers),
    allowUnknownFields: bool(raw.allowUnknownFields, true),
    validationMode: raw.validationMode === "failFast" ? "failFast" : "collectAll",
  };
}

function toConditions(value: unknown): Condition[] {
  const out: Condition[] = [];
  for (const raw of array(value)) {
    if (!isRecord(raw)) continue;
    out.push(
      newCondition({
        source: oneOf(CONDITION_SOURCES, raw.source, "body"),
        path: str(raw.path),
        operator: oneOf(CONDITION_OPERATORS, raw.operator, "eq"),
        value: ruleValue(raw.value),
      }),
    );
  }
  return out;
}

function toScenarios(value: unknown): ResponseScenario[] {
  const out: ResponseScenario[] = [];
  for (const raw of array(value)) {
    if (!isRecord(raw)) continue;
    out.push(
      newScenario({
        name: str(raw.name).trim() || "Scenario",
        description: optionalStr(raw.description),
        isDefault: bool(raw.isDefault, false),
        enabled: bool(raw.enabled, true),
        conditions: toConditions(raw.conditions),
        status: int(raw.status, 200),
        headers: headerMap(raw.headers),
        body: raw.body,
        delayMs: Math.max(0, int(raw.delayMs, 0)),
      }),
    );
  }
  if (out.length === 0) out.push(newScenario({ isDefault: true }));
  if (!out.some((scenario) => scenario.isDefault)) out[out.length - 1].isDefault = true;
  return out;
}

function toErrorTemplate(value: unknown, fallback: ErrorTemplate): ErrorTemplate {
  if (!isRecord(value)) return fallback;
  return {
    status: int(value.status, fallback.status),
    headers: headerMap(value.headers),
    body: value.body === undefined ? fallback.body : value.body,
  };
}

function toAuth(value: unknown): AuthSpec {
  const raw = isRecord(value) ? value : {};
  const type = oneOf(AUTH_TYPES, raw.type, "none");
  const auth: AuthSpec = { type };
  if (type === "apiKey") {
    auth.headerName = str(raw.headerName, "x-api-key");
    auth.token = str(raw.token);
  } else if (type === "bearer") {
    auth.token = str(raw.token);
  } else if (type === "basic") {
    auth.username = str(raw.username);
    auth.password = str(raw.password);
  }
  return auth;
}

export function toEndpoint(projectId: string, raw: Record<string, unknown>): EndpointDef {
  return newEndpoint(projectId, {
    name: str(raw.name).trim() || "Imported endpoint",
    description: str(raw.description),
    method: oneOf(HTTP_METHODS, raw.method, "POST"),
    path: normalizePath(str(raw.path, "/imported")),
    enabled: bool(raw.enabled, true),
    auth: toAuth(raw.auth),
    request: toRequestSpec(raw.request),
    scenarios: toScenarios(raw.scenarios),
    validationError: toErrorTemplate(raw.validationError, defaultValidationError()),
    authError: toErrorTemplate(raw.authError, defaultAuthError()),
    delayMs: Math.max(0, int(raw.delayMs, 0)),
    tags: stringList(raw.tags),
    notes: str(raw.notes),
  });
}

/* ------------------------------------------------------------------ *
 * Reading the uploaded document
 * ------------------------------------------------------------------ */

export interface ImportDoc {
  project: Record<string, unknown>;
  endpoints: Record<string, unknown>[];
}

/** Accepts `{ data: <doc> }` (the admin API shape and the exported file) or a bare doc. */
export function unwrap(payload: unknown): unknown {
  if (isRecord(payload) && payload.data !== undefined && !("project" in payload)) {
    return payload.data;
  }
  return payload;
}

export function collectDocs(value: unknown, depth = 0): ImportDoc[] {
  if (depth > 4) return [];
  if (Array.isArray(value)) return value.flatMap((entry) => collectDocs(entry, depth + 1));
  if (!isRecord(value)) return [];

  if (isRecord(value.project)) {
    return [
      {
        project: value.project,
        endpoints: array(value.endpoints).filter(isRecord),
      },
    ];
  }
  if (value.projects !== undefined) return collectDocs(value.projects, depth + 1);
  if (value.data !== undefined) return collectDocs(value.data, depth + 1);
  return [];
}
