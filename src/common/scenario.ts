/**
 * Scenario selection: dot-path lookup, condition evaluation and the
 * "which registered response wins?" decision used by the mock runtime.
 *
 * Browser-safe (no node imports) so the builder UI can preview a match.
 */

import type {
  Condition,
  ConditionSource,
  ResponseScenario,
  TemplateContext,
} from "./types";

/* ------------------------------------------------------------------ *
 * Path lookup
 * ------------------------------------------------------------------ */

/**
 * Reads "customer.accounts[0].number" out of an arbitrary value.
 * Returns undefined for anything that is missing - never throws.
 */
export function resolvePath(source: unknown, path: string): unknown {
  if (source === undefined || source === null) return undefined;
  const trimmed = typeof path === "string" ? path.trim() : "";
  if (!trimmed) return source;

  const parts = trimmed.match(/[^.[\]]+/g);
  if (!parts) return source;

  let current: unknown = source;
  for (const part of parts) {
    if (current === undefined || current === null) return undefined;
    const key = part.trim();
    if (!key) return undefined;

    if (key === "length" && (Array.isArray(current) || typeof current === "string")) {
      current = current.length;
      continue;
    }
    if (Array.isArray(current)) {
      const index = Number(key);
      if (!Number.isInteger(index) || index < 0) return undefined;
      current = current[index];
      continue;
    }
    if (typeof current === "object") {
      current = (current as Record<string, unknown>)[key];
      continue;
    }
    return undefined;
  }
  return current;
}

/**
 * Reads a value out of the template context by source + dot path.
 * Header names are matched case-insensitively.
 */
export function readContextValue(
  ctx: TemplateContext,
  source: ConditionSource,
  path: string,
): unknown {
  switch (source) {
    case "body":
      return resolvePath(ctx.body, path);
    case "query":
      return resolvePath(ctx.query, path);
    case "path":
      return resolvePath(ctx.path, path);
    case "headers":
      return readHeader(ctx.headers, path);
    default:
      return undefined;
  }
}

function readHeader(headers: Record<string, string> | undefined, path: string): unknown {
  if (!headers) return undefined;
  const name = typeof path === "string" ? path.trim() : "";
  if (!name) return headers;
  if (Object.prototype.hasOwnProperty.call(headers, name)) return headers[name];
  const wanted = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === wanted) return headers[key];
  }
  return undefined;
}

/* ------------------------------------------------------------------ *
 * Loose comparison helpers
 * ------------------------------------------------------------------ */

function asString(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

/** "12" / 12 -> 12, everything else -> undefined. */
function asNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const flag = value.trim().toLowerCase();
    if (flag === "true") return true;
    if (flag === "false") return false;
  }
  return undefined;
}

/** Numeric when both sides look numeric, boolean when both look boolean, else string. */
function looseEquals(a: unknown, b: unknown): boolean {
  const numA = asNumber(a);
  const numB = asNumber(b);
  if (numA !== undefined && numB !== undefined) return numA === numB;
  const boolA = asBoolean(a);
  const boolB = asBoolean(b);
  if (boolA !== undefined && boolB !== undefined) return boolA === boolB;
  return asString(a) === asString(b);
}

/** -1 | 0 | 1, or undefined when the comparison is meaningless. */
function compare(a: unknown, b: unknown): number | undefined {
  if (a === undefined || a === null) return undefined;
  const numA = asNumber(a);
  const numB = asNumber(b);
  if (numA !== undefined && numB !== undefined) {
    if (numA === numB) return 0;
    return numA < numB ? -1 : 1;
  }
  const strA = asString(a);
  const strB = asString(b);
  if (strA === strB) return 0;
  return strA < strB ? -1 : 1;
}

/** Accepts a string[] or a comma separated string. */
function toList(value: Condition["value"]): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    return value
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
  }
  if (value === undefined || value === null) return [];
  return [value];
}

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") {
    return Object.keys(value as Record<string, unknown>).length === 0;
  }
  return false;
}

/* ------------------------------------------------------------------ *
 * Conditions
 * ------------------------------------------------------------------ */

/** Evaluates one registered condition against the live request. Never throws. */
export function evaluateCondition(condition: Condition, ctx: TemplateContext): boolean {
  if (!condition) return false;
  const actual = readContextValue(ctx, condition.source, condition.path ?? "");
  const expected = condition.value;

  switch (condition.operator) {
    case "exists":
      return actual !== undefined && actual !== null;
    case "notExists":
      return actual === undefined || actual === null;
    case "empty":
      return isEmpty(actual);
    case "notEmpty":
      return !isEmpty(actual);
    case "eq":
      return looseEquals(actual, expected);
    case "neq":
      return !looseEquals(actual, expected);
    case "gt": {
      const order = compare(actual, expected);
      return order !== undefined && order > 0;
    }
    case "gte": {
      const order = compare(actual, expected);
      return order !== undefined && order >= 0;
    }
    case "lt": {
      const order = compare(actual, expected);
      return order !== undefined && order < 0;
    }
    case "lte": {
      const order = compare(actual, expected);
      return order !== undefined && order <= 0;
    }
    case "contains":
      if (Array.isArray(actual)) return actual.some((item) => looseEquals(item, expected));
      if (actual === undefined || actual === null) return false;
      return asString(actual).includes(asString(expected));
    case "notContains":
      if (Array.isArray(actual)) return !actual.some((item) => looseEquals(item, expected));
      if (actual === undefined || actual === null) return true;
      return !asString(actual).includes(asString(expected));
    case "startsWith":
      if (actual === undefined || actual === null) return false;
      return asString(actual).startsWith(asString(expected));
    case "endsWith":
      if (actual === undefined || actual === null) return false;
      return asString(actual).endsWith(asString(expected));
    case "regex": {
      if (actual === undefined || actual === null) return false;
      const source = asString(expected);
      if (!source) return false;
      try {
        return new RegExp(source).test(asString(actual));
      } catch {
        return false;
      }
    }
    case "in":
      return toList(expected).some((candidate) => looseEquals(actual, candidate));
    case "notIn":
      return !toList(expected).some((candidate) => looseEquals(actual, candidate));
    default:
      return false;
  }
}

/* ------------------------------------------------------------------ *
 * Scenario selection
 * ------------------------------------------------------------------ */

/**
 * The first enabled scenario whose conditions ALL pass wins (a scenario
 * without conditions always passes). Falls back to the scenario flagged
 * `isDefault`, then to the first enabled one, then to null.
 */
export function matchScenario(
  scenarios: ResponseScenario[],
  ctx: TemplateContext,
): ResponseScenario | null {
  const enabled = (scenarios ?? []).filter(
    (scenario) => scenario && scenario.enabled !== false,
  );
  if (enabled.length === 0) return null;

  for (const scenario of enabled) {
    const conditions = scenario.conditions ?? [];
    if (conditions.length === 0) return scenario;
    if (conditions.every((condition) => evaluateCondition(condition, ctx))) return scenario;
  }

  const preferred = enabled.find((scenario) => scenario.isDefault);
  return preferred ?? enabled[0];
}

/* ------------------------------------------------------------------ *
 * Human readable rendering (UI)
 * ------------------------------------------------------------------ */

const OPERATOR_LABELS: Record<Condition["operator"], string> = {
  eq: "==",
  neq: "!=",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  contains: "contains",
  notContains: "does not contain",
  startsWith: "starts with",
  endsWith: "ends with",
  regex: "matches",
  in: "in",
  notIn: "not in",
  exists: "is present",
  notExists: "is missing",
  empty: "is empty",
  notEmpty: "is not empty",
};

const UNARY_OPERATORS: ReadonlyArray<Condition["operator"]> = [
  "exists",
  "notExists",
  "empty",
  "notEmpty",
];

/** "body.amount > 50000" - shown on scenario cards and in the docs page. */
export function describeCondition(condition: Condition): string {
  if (!condition) return "";
  const path = (condition.path ?? "").trim();
  const subject = path ? `${condition.source}.${path}` : condition.source;
  const operator = OPERATOR_LABELS[condition.operator] ?? condition.operator;
  if (UNARY_OPERATORS.indexOf(condition.operator) !== -1) return `${subject} ${operator}`;

  const listed = condition.operator === "in" || condition.operator === "notIn";
  const rendered = listed
    ? `[${toList(condition.value).map((item) => asString(item)).join(", ")}]`
    : asString(condition.value);

  return `${subject} ${operator} ${rendered}`;
}
