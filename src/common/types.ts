/**
 * Mock API Studio - shared domain types.
 *
 * Everything a user "registers" lives in these shapes and is persisted as JSON
 * on the file system (see `src/lib/store.ts`). The mock runtime
 * (`src/app/api/mock/[...slug]/route.ts`) reads the very same shapes back.
 */

/* ------------------------------------------------------------------ *
 * HTTP
 * ------------------------------------------------------------------ */

export const HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
] as const;

export type HttpMethod = (typeof HTTP_METHODS)[number];

/* ------------------------------------------------------------------ *
 * Request schema - fields + validation rules
 * ------------------------------------------------------------------ */

export const FIELD_TYPES = [
  "string",
  "number",
  "integer",
  "boolean",
  "object",
  "array",
  "any",
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

/** Every validation rule the engine understands. */
export const RULE_IDS = [
  // presence
  "requiredIf",
  "requiredUnless",
  // string
  "minLength",
  "maxLength",
  "exactLength",
  "pattern",
  "email",
  "url",
  "uuid",
  "alpha",
  "alphanumeric",
  "numericString",
  "startsWith",
  "endsWith",
  "noWhitespace",
  "lowercase",
  "uppercase",
  // number
  "min",
  "max",
  "greaterThan",
  "lessThan",
  "positive",
  "negative",
  "multipleOf",
  "maxDecimals",
  // choice
  "enum",
  "notIn",
  // date / time
  "date",
  "dateFormat",
  "before",
  "after",
  "minAge",
  // array
  "minItems",
  "maxItems",
  "uniqueItems",
  // cross-field
  "equalsField",
  "notEqualsField",
  "gtField",
  "ltField",
  // escape hatch
  "custom",
] as const;

export type RuleId = (typeof RULE_IDS)[number];

/** A single configured rule on a field. */
export interface ValidationRule {
  /** row id, unique inside the field */
  id: string;
  rule: RuleId;
  /** rule argument: number for min/max, string for pattern, string[] for enum, etc. */
  value?: string | number | boolean | string[] | null;
  /** second argument, used by rules like `requiredIf` (otherField, equalsValue) */
  value2?: string | number | boolean | null;
  /** optional custom message; supports {field} {value} {arg} {arg2} placeholders */
  message?: string;
  enabled: boolean;
}

/** One key of a payload (body / query / header), recursively nestable. */
export interface FieldDef {
  id: string;
  /** the JSON key, e.g. "accountNumber" */
  name: string;
  /** human label shown in the UI / docs */
  label?: string;
  type: FieldType;
  required: boolean;
  description?: string;
  /** example value used for docs, seeded try-it payloads and OpenAPI export */
  example?: unknown;
  /** value injected when the caller omits an optional key */
  defaultValue?: unknown;
  rules: ValidationRule[];
  /** object => its properties; array of objects => the item's properties */
  children: FieldDef[];
  /** for type === "array": what each item is */
  itemType?: FieldType;
}

export const CONTENT_TYPES = [
  "application/json",
  "application/x-www-form-urlencoded",
  "none",
  "text/xml",
  "application/soap+xml",
  "application/xml",
  "text/plain",
] as const;

export type ContentType = (typeof CONTENT_TYPES)[number];

export type ValidationMode = "collectAll" | "failFast";

/** The full "payload contract" a user registers for an endpoint. */
export interface RequestSpec {
  contentType: ContentType;
  body: FieldDef[];
  query: FieldDef[];
  headers: FieldDef[];
  /** reject keys that were never registered */
  allowUnknownFields: boolean;
  /** collect every error at once (default) or stop at the first */
  validationMode: ValidationMode;
  /**
   * Example request body for a non-structured content type (SOAP/XML/plain
   * text, ...), where there is no FieldDef tree to derive one from. Ignored
   * by the runtime; only feeds the builder's preview/curl sample, Try-It's
   * seeded body and the OpenAPI/Postman exporters.
   */
  sampleBody?: string;
}

/* ------------------------------------------------------------------ *
 * Auth on the mock endpoint itself
 * ------------------------------------------------------------------ */

export const AUTH_TYPES = ["none", "apiKey", "bearer", "basic"] as const;
export type AuthType = (typeof AUTH_TYPES)[number];

export interface AuthSpec {
  type: AuthType;
  /** apiKey: header name, e.g. "x-api-key" */
  headerName?: string;
  /** apiKey / bearer: the expected secret */
  token?: string;
  /** basic */
  username?: string;
  password?: string;
}

/* ------------------------------------------------------------------ *
 * Response - scenarios + templates
 * ------------------------------------------------------------------ */

export const CONDITION_SOURCES = ["body", "query", "headers", "path"] as const;
export type ConditionSource = (typeof CONDITION_SOURCES)[number];

export const CONDITION_OPERATORS = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "notContains",
  "startsWith",
  "endsWith",
  "regex",
  "in",
  "notIn",
  "exists",
  "notExists",
  "empty",
  "notEmpty",
] as const;

export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

/** e.g. "when body.amount > 50000" */
export interface Condition {
  id: string;
  source: ConditionSource;
  /** dot path inside the source, e.g. "customer.accountNo" */
  path: string;
  operator: ConditionOperator;
  value?: string | number | boolean | string[] | null;
}

/**
 * A registered response. The first enabled scenario whose conditions all match
 * wins; if none match, the scenario flagged `isDefault` is used.
 */
export interface ResponseScenario {
  id: string;
  name: string;
  description?: string;
  isDefault: boolean;
  enabled: boolean;
  /** ALL conditions must pass (AND). Empty => always matches. */
  conditions: Condition[];
  status: number;
  headers: Record<string, string>;
  /** JSON template - string values may contain {{tokens}} */
  body: unknown;
  /** artificial latency, ms */
  delayMs: number;
}

/** Shape of the auto-generated error responses. */
export interface ErrorTemplate {
  status: number;
  headers: Record<string, string>;
  /** template; understands {{errors}}, {{errorCount}}, {{firstError.*}} */
  body: unknown;
}

/* ------------------------------------------------------------------ *
 * Endpoint + Project
 * ------------------------------------------------------------------ */

export interface EndpointDef {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  method: HttpMethod;
  /** leading-slash path, supports params: "/accounts/:accountId/transfer" */
  path: string;
  enabled: boolean;
  auth: AuthSpec;
  request: RequestSpec;
  /** content type the runtime renders scenario/error bodies as. */
  responseContentType: ContentType;
  scenarios: ResponseScenario[];
  validationError: ErrorTemplate;
  authError: ErrorTemplate;
  /** global artificial latency added on top of the scenario delay */
  delayMs: number;
  tags: string[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDef {
  id: string;
  name: string;
  /** URL segment: /api/mock/<slug>/... */
  slug: string;
  description?: string;
  /** headers merged into every response of the project */
  defaultHeaders: Record<string, string>;
  color: string;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ *
 * Validation results
 * ------------------------------------------------------------------ */

export type IssueLocation = "body" | "query" | "headers" | "path" | "auth";

export interface ValidationIssue {
  location: IssueLocation;
  /** dot path, e.g. "customer.accounts[0].number" */
  field: string;
  /** which rule failed; "required" / "type" / "unknownField" / "json" are built in */
  rule: RuleId | "required" | "type" | "unknownField" | "json";
  message: string;
  received?: unknown;
  expected?: unknown;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  /** the payload after coercion + defaults, used for response templating */
  value: Record<string, unknown>;
}

/* ------------------------------------------------------------------ *
 * Runtime logging
 * ------------------------------------------------------------------ */

export type LogOutcome =
  | "matched"
  | "validation_failed"
  | "auth_failed"
  | "not_found"
  | "disabled";

export interface RequestLog {
  id: string;
  ts: string;
  projectId: string | null;
  projectSlug: string | null;
  endpointId: string | null;
  endpointName: string | null;
  method: string;
  /** the mock path that was called, e.g. "/npsb/transfer" */
  path: string;
  url: string;
  status: number;
  durationMs: number;
  outcome: LogOutcome;
  scenarioId: string | null;
  scenarioName: string | null;
  requestHeaders: Record<string, string>;
  requestQuery: Record<string, string>;
  requestBody: unknown;
  responseBody: unknown;
  issues: ValidationIssue[];
  ip?: string;
}

/* ------------------------------------------------------------------ *
 * Studio users (the people using this tool - not the mock endpoints)
 * ------------------------------------------------------------------ */

export type UserRole = "admin" | "member";

export interface StudioUser {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  /** pbkdf2 digest stored as `salt:hash` */
  passwordHash: string;
  createdAt: string;
}

/** What is signed into the session cookie. */
export interface SessionPayload {
  sub: string;
  username: string;
  name: string;
  role: UserRole;
  /** unix seconds */
  exp: number;
}

/* ------------------------------------------------------------------ *
 * Template context handed to the response renderer
 * ------------------------------------------------------------------ */

export interface TemplateContext {
  /** a raw string for a non-structured (e.g. SOAP/XML) request body */
  body: Record<string, unknown> | string;
  query: Record<string, unknown>;
  headers: Record<string, string>;
  path: Record<string, string>;
  issues?: ValidationIssue[];
  meta?: Record<string, unknown>;
}

/* ------------------------------------------------------------------ *
 * Admin API payloads
 * ------------------------------------------------------------------ */

export type ProjectInput = Omit<ProjectDef, "id" | "createdAt" | "updatedAt"> &
  Partial<Pick<ProjectDef, "id">>;

export type EndpointInput = Omit<EndpointDef, "id" | "createdAt" | "updatedAt"> &
  Partial<Pick<EndpointDef, "id">>;

export interface ApiOk<T> {
  ok: true;
  data: T;
}

export interface ApiErr {
  ok: false;
  error: string;
  issues?: ValidationIssue[];
}

export type ApiResponse<T> = ApiOk<T> | ApiErr;
