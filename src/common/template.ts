/**
 * {{token}} interpolation for response and error templates.
 *
 * A template is any JSON value; every string inside it (values *and* object
 * keys) is scanned for tokens. A string that is exactly one token keeps the
 * resolved value's native type, a mixed string is stringified.
 *
 * Browser-safe (no node imports) so the builder UI can preview a rendered body.
 */

import { uuid } from "./ids";
import { resolvePath } from "./scenario";
import type { TemplateContext, ValidationIssue } from "./types";

/** The one and only tokeniser. Matches `{{ anything-but-braces }}`. */
const TOKEN_RE = /\{\{\s*([^{}]*?)\s*\}\}/g;

const MAX_DEPTH = 20;

export interface TokenDoc {
  token: string;
  description: string;
  example: string;
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

/**
 * Walks a template value recursively (arrays, plain objects and object keys)
 * and renders every string it finds.
 */
export function renderTemplate(template: unknown, ctx: TemplateContext): unknown {
  return walk(template, ctx, 0);
}

/**
 * Renders one string.
 * - `"{{body.amount}}"` -> the native value (number stays a number, missing -> null)
 * - `"Txn {{uuid}} ok"` -> a string with every token substituted
 * - a string without tokens is returned untouched
 */
export function renderString(input: string, ctx: TemplateContext): unknown {
  if (typeof input !== "string" || input.indexOf("{{") === -1) return input;

  TOKEN_RE.lastIndex = 0;
  const first = TOKEN_RE.exec(input);
  TOKEN_RE.lastIndex = 0;
  if (!first) return input;

  if (first.index === 0 && first[0].length === input.length) {
    const value = resolveToken(first[1], ctx);
    return value === undefined ? null : value;
  }

  return input.replace(TOKEN_RE, (_match, expression: string) =>
    stringifyValue(resolveToken(expression, ctx)),
  );
}

/* ------------------------------------------------------------------ *
 * Recursion
 * ------------------------------------------------------------------ */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function walk(node: unknown, ctx: TemplateContext, depth: number): unknown {
  if (depth > MAX_DEPTH) return node;

  if (typeof node === "string") return renderString(node, ctx);
  if (Array.isArray(node)) return node.map((item) => walk(item, ctx, depth + 1));
  if (isPlainObject(node)) {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      const renderedKey = stringifyValue(renderString(key, ctx));
      out[renderedKey || key] = walk(value, ctx, depth + 1);
    }
    return out;
  }
  return node;
}

/* ------------------------------------------------------------------ *
 * Token resolution
 * ------------------------------------------------------------------ */

function stringifyValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function resolveToken(rawExpression: string, ctx: TemplateContext): unknown {
  const expression = (rawExpression ?? "").trim();
  if (!expression) return undefined;

  const split = splitFallback(expression);
  if (split) {
    const primary = resolveExpression(split.expression, ctx);
    if (primary === undefined || primary === null || primary === "") {
      return parseLiteral(split.fallback);
    }
    return primary;
  }
  return resolveExpression(expression, ctx);
}

/** Finds the `||` of `{{body.remarks || "N/A"}}`, ignoring quotes and calls. */
function splitFallback(expression: string): { expression: string; fallback: string } | null {
  let quote = "";
  let depth = 0;
  for (let i = 0; i < expression.length - 1; i++) {
    const char = expression[i];
    if (quote) {
      if (char === "\\") i++;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "(") depth++;
    else if (char === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0 && char === "|" && expression[i + 1] === "|") {
      return {
        expression: expression.slice(0, i).trim(),
        fallback: expression.slice(i + 2).trim(),
      };
    }
  }
  return null;
}

function resolveExpression(expression: string, ctx: TemplateContext): unknown {
  if (!expression) return undefined;
  const generated = resolveGenerator(expression);
  if (generated !== undefined) return generated;
  const validation = resolveValidation(expression, ctx);
  if (validation !== undefined) return validation;
  return resolveDataPath(expression, ctx);
}

/* --------------------------- data echo ---------------------------- */

function resolveDataPath(expression: string, ctx: TemplateContext): unknown {
  const dot = expression.indexOf(".");
  const head = dot === -1 ? expression : expression.slice(0, dot);
  const rest = dot === -1 ? "" : expression.slice(dot + 1).trim();

  switch (head) {
    case "body":
      return rest ? resolvePath(ctx.body, rest) : ctx.body;
    case "query":
      return rest ? resolvePath(ctx.query, rest) : ctx.query;
    case "path":
      return rest ? resolvePath(ctx.path, rest) : ctx.path;
    case "meta":
      return rest ? resolvePath(ctx.meta, rest) : ctx.meta;
    case "headers":
      return rest ? readHeader(ctx.headers, rest) : ctx.headers;
    default:
      return undefined;
  }
}

/** Header lookup is case-insensitive: `{{headers.X-Request-Id}}` finds `x-request-id`. */
function readHeader(headers: Record<string, string> | undefined, name: string): unknown {
  if (!headers) return undefined;
  if (Object.prototype.hasOwnProperty.call(headers, name)) return headers[name];
  const wanted = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === wanted) return headers[key];
  }
  return undefined;
}

/* ----------------------- validation context ----------------------- */

interface ErrorEntry {
  field: string;
  message: string;
  rule: string;
}

function toErrorEntry(issue: ValidationIssue): ErrorEntry {
  return { field: issue.field, message: issue.message, rule: issue.rule };
}

function resolveValidation(expression: string, ctx: TemplateContext): unknown {
  const issues = ctx.issues ?? [];

  if (expression === "errors") return issues.map(toErrorEntry);
  if (expression === "errorCount") return issues.length;
  if (expression === "firstError") {
    return issues.length > 0 ? toErrorEntry(issues[0]) : undefined;
  }
  if (expression.startsWith("firstError.")) {
    if (issues.length === 0) return undefined;
    const entry = toErrorEntry(issues[0]);
    switch (expression.slice("firstError.".length)) {
      case "field":
        return entry.field;
      case "message":
        return entry.message;
      case "rule":
        return entry.rule;
      default:
        return undefined;
    }
  }
  return undefined;
}

/* --------------------------- generators --------------------------- */

const RANDOM_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function randomFloat(): number {
  const webCrypto = globalThis.crypto;
  if (webCrypto && typeof webCrypto.getRandomValues === "function") {
    const buffer = new Uint32Array(1);
    webCrypto.getRandomValues(buffer);
    return buffer[0] / 4294967296;
  }
  return Math.random();
}

function randomInt(min: number, max: number): number {
  const low = Math.ceil(Math.min(min, max));
  const high = Math.floor(Math.max(min, max));
  if (!Number.isFinite(low) || !Number.isFinite(high) || high < low) return low;
  return low + Math.floor(randomFloat() * (high - low + 1));
}

function numericArg(args: unknown[], index: number, fallback: number): number {
  const raw = args[index];
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim()) {
    const parsed = Number(raw.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

/** Returns undefined when the expression is not a generator. */
function resolveGenerator(expression: string): unknown {
  const call = /^([A-Za-z][A-Za-z0-9_]*)\s*\(([\s\S]*)\)$/.exec(expression);
  if (call) return resolveGeneratorCall(call[1], parseArgs(call[2]));

  const now = new Date();
  switch (expression) {
    case "uuid":
      return uuid();
    case "now":
      return now.toISOString();
    case "now:date":
      return now.toISOString().slice(0, 10);
    case "now:time":
      return now.toISOString().slice(11, 19);
    case "now:unix":
      return Math.floor(now.getTime() / 1000);
    case "timestamp":
      return now.getTime();
    default:
      return undefined;
  }
}

function resolveGeneratorCall(name: string, args: unknown[]): unknown {
  switch (name) {
    case "randomInt":
      return randomInt(numericArg(args, 0, 0), numericArg(args, 1, 100));
    case "randomDecimal": {
      const min = numericArg(args, 0, 0);
      const max = numericArg(args, 1, 100);
      const places = Math.min(10, Math.max(0, Math.round(numericArg(args, 2, 2))));
      const low = Math.min(min, max);
      const high = Math.max(min, max);
      return Number((low + randomFloat() * (high - low)).toFixed(places));
    }
    case "randomString": {
      const length = Math.min(512, Math.max(1, Math.round(numericArg(args, 0, 8))));
      let out = "";
      for (let i = 0; i < length; i++) {
        out += RANDOM_ALPHABET[Math.floor(randomFloat() * RANDOM_ALPHABET.length)];
      }
      return out;
    }
    case "randomDigits": {
      const length = Math.min(64, Math.max(1, Math.round(numericArg(args, 0, 6))));
      let out = "";
      for (let i = 0; i < length; i++) out += String(randomInt(0, 9));
      return out;
    }
    case "pick":
      return args.length > 0 ? args[randomInt(0, args.length - 1)] : undefined;
    case "uuid":
      return uuid();
    default:
      return undefined;
  }
}

/* ---------------------------- literals ---------------------------- */

/** Splits `"A", "B", 3` into its arguments, respecting quotes. */
function parseArgs(raw: string): unknown[] {
  const text = raw.trim();
  if (!text) return [];

  const parts: string[] = [];
  let current = "";
  let quote = "";
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      if (char === "\\" && i + 1 < text.length) {
        current += char + text[i + 1];
        i++;
      } else {
        current += char;
        if (char === quote) quote = "";
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === ",") {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts.map((part) => parseLiteral(part));
}

/** `"N/A"` -> "N/A", `none`/`null` -> null, `true` -> true, `42` -> 42. */
function parseLiteral(raw: string): unknown {
  const text = (raw ?? "").trim();
  if (!text) return "";

  const quoted =
    text.length >= 2 &&
    ((text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("'") && text.endsWith("'")));
  if (quoted) return text.slice(1, -1).replace(/\\(["'\\])/g, "$1");

  const lower = text.toLowerCase();
  if (lower === "true") return true;
  if (lower === "false") return false;
  if (lower === "null" || lower === "none" || lower === "nil" || lower === "undefined") {
    return null;
  }
  const numeric = Number(text);
  if (Number.isFinite(numeric)) return numeric;
  return text;
}

/* ------------------------------------------------------------------ *
 * Cheat-sheet rendered by the builder UI and the docs page
 * ------------------------------------------------------------------ */

export const TEMPLATE_TOKENS: TokenDoc[] = [
  {
    token: "{{body.amount}}",
    description: "Echoes a top-level key of the request body, keeping its native JSON type.",
    example: "12500.5",
  },
  {
    token: "{{body.customer.name}}",
    description: "Reaches into nested objects with a dot path.",
    example: "Rahim Uddin",
  },
  {
    token: "{{body.items[0].id}}",
    description: "Indexes into an array inside the body.",
    example: "ITM-001",
  },
  {
    token: "{{query.page}}",
    description: "A query-string value from the incoming URL.",
    example: "2",
  },
  {
    token: "{{headers.x-request-id}}",
    description: "A request header; the name is matched case-insensitively.",
    example: "b3f1c2d4-9a77-4e21-bb0c-5f9a2c1d3e88",
  },
  {
    token: "{{path.accountNumber}}",
    description: "A value captured by a :param segment of the endpoint path.",
    example: "1234567890",
  },
  {
    token: "{{meta.method}}",
    description: "The HTTP method the caller used.",
    example: "POST",
  },
  {
    token: "{{meta.path}}",
    description: "The mock path that was called.",
    example: "/npsb/transfer",
  },
  {
    token: "{{meta.endpoint}}",
    description: "The name of the endpoint that handled the request.",
    example: "NPSB Fund Transfer",
  },
  {
    token: '{{body.remarks || "N/A"}}',
    description: "Falls back to the quoted literal when the value is missing or empty.",
    example: "N/A",
  },
  {
    token: "{{body.channel || none}}",
    description: "A bare fallback word: none / null render as JSON null, other words as text.",
    example: "null",
  },
  {
    token: "{{uuid}}",
    description: "A fresh random UUID v4 - handy for requestId / referenceNo fields.",
    example: "6f9619ff-8b86-d011-b42d-00cf4fc964ff",
  },
  {
    token: "{{now}}",
    description: "Current UTC time as an ISO 8601 string.",
    example: "2026-08-12T09:30:00.000Z",
  },
  {
    token: "{{now:date}}",
    description: "Current UTC date as YYYY-MM-DD.",
    example: "2026-08-12",
  },
  {
    token: "{{now:time}}",
    description: "Current UTC time of day as HH:MM:SS.",
    example: "09:30:00",
  },
  {
    token: "{{now:unix}}",
    description: "Current time as unix seconds (a number).",
    example: "1786606200",
  },
  {
    token: "{{timestamp}}",
    description: "Current time as unix milliseconds (a number).",
    example: "1786606200000",
  },
  {
    token: "{{randomInt(1,999)}}",
    description: "A random whole number between the two bounds, inclusive.",
    example: "742",
  },
  {
    token: "{{randomDecimal(1,100,2)}}",
    description: "A random decimal between two bounds, rounded to the given places.",
    example: "63.47",
  },
  {
    token: "{{randomString(8)}}",
    description: "A random alphanumeric string of the given length.",
    example: "Kp3xQ8ra",
  },
  {
    token: "{{randomDigits(6)}}",
    description: "A random digits-only string, useful for OTPs and reference numbers.",
    example: "480931",
  },
  {
    token: '{{pick("A","B","C")}}',
    description: "Picks one of the listed values at random.",
    example: "B",
  },
  {
    token: "{{errors}}",
    description: "Validation-error templates only: the full array of { field, message, rule }.",
    example: '[{"field":"amount","message":"amount is required","rule":"required"}]',
  },
  {
    token: "{{errorCount}}",
    description: "Validation-error templates only: how many issues were found (a number).",
    example: "2",
  },
  {
    token: "{{firstError.field}}",
    description: "Validation-error templates only: the field of the first issue.",
    example: "amount",
  },
  {
    token: "{{firstError.message}}",
    description: "Validation-error templates only: the message of the first issue.",
    example: "amount must be at least 10",
  },
  {
    token: "{{firstError.rule}}",
    description: "Validation-error templates only: which rule produced the first issue.",
    example: "min",
  },
];
