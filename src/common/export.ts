/**
 * Exporters.
 *
 * A registered project can leave the studio in three shapes:
 *
 *  - `toStudioJson`  - the native format, round-trips through `/api/admin/import`
 *  - `toOpenApi`     - OpenAPI 3.1, for Swagger UI / code generators
 *  - `toPostman`     - a Postman v2.1 collection the QA team can just import
 *
 * Pure data in, pure data out: no file system, no request objects, so the same
 * functions can be used from a route handler or from a server component.
 */

import { isStructuredContentType } from "./content-type";
import { uuid } from "./ids";
import type {
  AuthSpec,
  ContentType,
  EndpointDef,
  FieldDef,
  FieldType,
  ProjectDef,
  RequestSpec,
  ResponseScenario,
  ValidationRule,
} from "./types";

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

function text(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/** `enum` / `notIn` accept both `string[]` and "A, B, C". */
function asList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => (text(entry) ?? "").trim()).filter((entry) => entry !== "");
  }
  const single = text(value);
  if (single === undefined) return [];
  return single
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function enabledRules(field: FieldDef): ValidationRule[] {
  return Array.isArray(field.rules) ? field.rules.filter((rule) => rule.enabled) : [];
}

function findRule(field: FieldDef, id: ValidationRule["rule"]): ValidationRule | undefined {
  return enabledRules(field).find((rule) => rule.rule === id);
}

function trimOrigin(origin: string): string {
  return (origin || "").replace(/\/+$/, "");
}

function mockBase(project: ProjectDef, origin: string): string {
  return `${trimOrigin(origin)}/api/mock/${project.slug}`;
}

function hasRequestBody(endpoint: EndpointDef): boolean {
  if (endpoint.request.contentType === "none") return false;
  if (endpoint.method === "GET" || endpoint.method === "HEAD" || endpoint.method === "OPTIONS") {
    return false;
  }
  if (!isStructuredContentType(endpoint.request.contentType)) return true;
  return endpoint.request.body.length > 0;
}

/* ------------------------------------------------------------------ *
 * JSON Schema
 * ------------------------------------------------------------------ */

function jsonType(type: FieldType | undefined): string | undefined {
  switch (type) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "integer":
      return "integer";
    case "boolean":
      return "boolean";
    case "object":
      return "object";
    case "array":
      return "array";
    default:
      return undefined;
  }
}

/** "YYYY-MM-DD" -> "^\d{4}-\d{2}-\d{2}$" */
function dateFormatPattern(format: string): string {
  let out = "";
  let index = 0;
  while (index < format.length) {
    const rest = format.slice(index);
    if (rest.startsWith("YYYY")) {
      out += "\\d{4}";
      index += 4;
    } else if (
      rest.startsWith("MM") ||
      rest.startsWith("DD") ||
      rest.startsWith("HH") ||
      rest.startsWith("mm") ||
      rest.startsWith("ss")
    ) {
      out += "\\d{2}";
      index += 2;
    } else {
      out += escapeRegex(format[index]);
      index += 1;
    }
  }
  return `^${out}$`;
}

function castChoices(list: string[], type: FieldType): Array<string | number | boolean> {
  if (type === "number" || type === "integer") {
    const numbers = list.map((entry) => Number(entry));
    if (numbers.every((entry) => Number.isFinite(entry))) return numbers;
  }
  if (type === "boolean") {
    const booleans = list.filter((entry) => entry === "true" || entry === "false");
    if (booleans.length === list.length) return booleans.map((entry) => entry === "true");
  }
  return list;
}

function applyRules(schema: Record<string, unknown>, field: FieldDef): void {
  const derivedPatterns: string[] = [];

  for (const rule of enabledRules(field)) {
    switch (rule.rule) {
      case "minLength": {
        const value = num(rule.value);
        if (value !== undefined) schema.minLength = value;
        break;
      }
      case "maxLength": {
        const value = num(rule.value);
        if (value !== undefined) schema.maxLength = value;
        break;
      }
      case "exactLength": {
        const value = num(rule.value);
        if (value !== undefined) {
          schema.minLength = value;
          schema.maxLength = value;
        }
        break;
      }
      case "pattern": {
        const value = text(rule.value);
        if (value) schema.pattern = value;
        break;
      }
      case "email":
        schema.format = "email";
        break;
      case "url":
        schema.format = "uri";
        break;
      case "uuid":
        schema.format = "uuid";
        break;
      case "numericString":
        derivedPatterns.push("^[0-9]+$");
        break;
      case "alpha":
        derivedPatterns.push("^[A-Za-z]+$");
        break;
      case "alphanumeric":
        derivedPatterns.push("^[A-Za-z0-9]+$");
        break;
      case "noWhitespace":
        derivedPatterns.push("^\\S+$");
        break;
      case "lowercase":
        derivedPatterns.push("^[^A-Z]*$");
        break;
      case "uppercase":
        derivedPatterns.push("^[^a-z]*$");
        break;
      case "startsWith": {
        const value = text(rule.value);
        if (value) derivedPatterns.push(`^${escapeRegex(value)}`);
        break;
      }
      case "endsWith": {
        const value = text(rule.value);
        if (value) derivedPatterns.push(`${escapeRegex(value)}$`);
        break;
      }
      case "min": {
        const value = num(rule.value);
        if (value !== undefined) schema.minimum = value;
        break;
      }
      case "max": {
        const value = num(rule.value);
        if (value !== undefined) schema.maximum = value;
        break;
      }
      case "greaterThan": {
        const value = num(rule.value);
        if (value !== undefined) schema.exclusiveMinimum = value;
        break;
      }
      case "lessThan": {
        const value = num(rule.value);
        if (value !== undefined) schema.exclusiveMaximum = value;
        break;
      }
      case "positive":
        schema.exclusiveMinimum = 0;
        break;
      case "negative":
        schema.exclusiveMaximum = 0;
        break;
      case "multipleOf": {
        const value = num(rule.value);
        if (value !== undefined && value !== 0) schema.multipleOf = value;
        break;
      }
      case "maxDecimals": {
        const value = num(rule.value);
        if (value !== undefined && value >= 0) {
          const places = Math.trunc(value);
          schema.multipleOf = Number(`1e-${places}`);
        }
        break;
      }
      case "enum": {
        const list = asList(rule.value);
        if (list.length > 0) schema.enum = castChoices(list, field.type);
        break;
      }
      case "notIn": {
        const list = asList(rule.value);
        if (list.length > 0) schema.not = { enum: castChoices(list, field.type) };
        break;
      }
      case "date":
        schema.format = "date-time";
        break;
      case "dateFormat": {
        const value = text(rule.value);
        if (value) {
          schema.format = /HH|mm|ss/.test(value) ? "date-time" : "date";
          derivedPatterns.push(dateFormatPattern(value));
        }
        break;
      }
      case "minItems": {
        const value = num(rule.value);
        if (value !== undefined) schema.minItems = value;
        break;
      }
      case "maxItems": {
        const value = num(rule.value);
        if (value !== undefined) schema.maxItems = value;
        break;
      }
      case "uniqueItems":
        schema.uniqueItems = true;
        break;
      default:
        /* requiredIf / requiredUnless / cross-field / custom have no keyword */
        break;
    }
  }

  if (schema.pattern === undefined && derivedPatterns.length === 1) {
    schema.pattern = derivedPatterns[0];
  } else if (schema.pattern === undefined && derivedPatterns.length > 1) {
    schema.allOf = derivedPatterns.map((pattern) => ({ pattern }));
  }
}

function fieldSchema(field: FieldDef): Record<string, unknown> {
  const schema: Record<string, unknown> = {};
  const type = jsonType(field.type);
  if (type) schema.type = type;

  if (field.type === "object") {
    Object.assign(schema, fieldsToJsonSchema(field.children));
  } else if (field.type === "array") {
    schema.items =
      field.itemType === "object"
        ? fieldsToJsonSchema(field.children)
        : { type: jsonType(field.itemType) ?? "string" };
  }

  if (field.label && field.label !== field.name) schema.title = field.label;
  if (field.description) schema.description = field.description;
  if (field.defaultValue !== undefined) schema.default = field.defaultValue;
  if (field.example !== undefined) schema.example = field.example;

  applyRules(schema, field);
  return schema;
}

/**
 * Turns a registered field list into a JSON Schema object node - the registered
 * rules become the matching JSON Schema keywords.
 */
export function fieldsToJsonSchema(fields: FieldDef[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const field of fields) {
    const name = (field.name || "").trim();
    if (!name) continue;
    properties[name] = fieldSchema(field);
    if (field.required) required.push(name);
  }

  const schema: Record<string, unknown> = { type: "object", properties };
  if (required.length > 0) schema.required = required;
  return schema;
}

/* ------------------------------------------------------------------ *
 * Sample values (used by the request-body / Postman examples)
 * ------------------------------------------------------------------ */

function sampleString(field: FieldDef): string {
  const choices = findRule(field, "enum");
  const list = choices ? asList(choices.value) : [];
  if (list.length > 0) return list[0];

  const exact = num(findRule(field, "exactLength")?.value);
  const min = num(findRule(field, "minLength")?.value);
  const length = exact ?? min;

  if (findRule(field, "uuid")) return "6f9619ff-8b86-d011-b42d-00cf4fc964ff";
  if (findRule(field, "email")) return "customer@example.com";
  if (findRule(field, "url")) return "https://example.com";
  if (findRule(field, "dateFormat") || findRule(field, "date")) return "2026-08-12";
  if (findRule(field, "numericString")) return "0".repeat(Math.max(1, length ?? 6));
  if (length !== undefined) return "x".repeat(Math.max(1, Math.min(length, 24)));
  return field.name || "string";
}

function sampleValue(field: FieldDef): unknown {
  if (field.example !== undefined) return field.example;
  if (field.defaultValue !== undefined) return field.defaultValue;

  switch (field.type) {
    case "string":
      return sampleString(field);
    case "number":
    case "integer": {
      const choices = asList(findRule(field, "enum")?.value);
      if (choices.length > 0) {
        const parsed = Number(choices[0]);
        if (Number.isFinite(parsed)) return parsed;
      }
      const min = num(findRule(field, "min")?.value);
      if (min !== undefined) return min;
      return field.type === "integer" ? 1 : 100;
    }
    case "boolean":
      return true;
    case "object":
      return sampleObject(field.children);
    case "array": {
      if (field.itemType === "object") return [sampleObject(field.children)];
      if (field.itemType === "number" || field.itemType === "integer") return [1];
      if (field.itemType === "boolean") return [true];
      return ["item"];
    }
    default:
      return null;
  }
}

function sampleObject(fields: FieldDef[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    const name = (field.name || "").trim();
    if (!name) continue;
    out[name] = sampleValue(field);
  }
  return out;
}

/** A believable value for a `:param` segment. */
function samplePathParam(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes("account")) return "1010000000002";
  if (lower.includes("mobile") || lower.includes("msisdn")) return "01712345678";
  if (lower.includes("nid")) return "1990123456789";
  if (lower.includes("date")) return "2026-08-12";
  if (lower.includes("id") || lower.includes("no")) return "123456";
  return "value";
}

function pathParamNames(endpointPath: string): string[] {
  return endpointPath
    .split("/")
    .filter((segment) => segment.startsWith(":") && segment.length > 1)
    .map((segment) => segment.slice(1));
}

/* ------------------------------------------------------------------ *
 * Native studio format
 * ------------------------------------------------------------------ */

function endpointDocument(endpoint: EndpointDef): Record<string, unknown> {
  return {
    name: endpoint.name,
    description: endpoint.description ?? "",
    method: endpoint.method,
    path: endpoint.path,
    enabled: endpoint.enabled,
    auth: endpoint.auth,
    request: endpoint.request,
    scenarios: endpoint.scenarios,
    validationError: endpoint.validationError,
    authError: endpoint.authError,
    delayMs: endpoint.delayMs,
    tags: endpoint.tags,
    notes: endpoint.notes ?? "",
  };
}

/**
 * The native backup format. Feed the whole document (or `{ data: <document> }`)
 * back to `POST /api/admin/import` to recreate the project somewhere else.
 */
export function toStudioJson(project: ProjectDef, endpoints: EndpointDef[]): unknown {
  return {
    kind: "mock-api-studio/project",
    version: 1,
    exportedAt: new Date().toISOString(),
    project: {
      name: project.name,
      slug: project.slug,
      description: project.description ?? "",
      color: project.color,
      defaultHeaders: project.defaultHeaders,
    },
    endpoints: endpoints.map(endpointDocument),
  };
}

/* ------------------------------------------------------------------ *
 * OpenAPI 3.1
 * ------------------------------------------------------------------ */

function openApiPath(endpointPath: string): string {
  return endpointPath
    .split("/")
    .map((segment) => (segment.startsWith(":") ? `{${segment.slice(1)}}` : segment))
    .join("/");
}

function securitySchemeName(auth: AuthSpec): string | null {
  switch (auth.type) {
    case "apiKey":
      return "apiKeyAuth";
    case "bearer":
      return "bearerAuth";
    case "basic":
      return "basicAuth";
    default:
      return null;
  }
}

function securityScheme(auth: AuthSpec): Record<string, unknown> {
  switch (auth.type) {
    case "apiKey":
      return {
        type: "apiKey",
        in: "header",
        name: auth.headerName || "x-api-key",
        description: "Sandbox API key configured on the endpoint.",
      };
    case "bearer":
      return { type: "http", scheme: "bearer", description: "Sandbox bearer token." };
    default:
      return { type: "http", scheme: "basic", description: "Sandbox basic credentials." };
  }
}

function parameterObject(field: FieldDef, location: "query" | "header"): Record<string, unknown> {
  const parameter: Record<string, unknown> = {
    name: field.name,
    in: location,
    required: field.required,
    schema: fieldSchema(field),
    example: sampleValue(field),
  };
  if (field.description) parameter.description = field.description;
  return parameter;
}

function operationId(endpoint: EndpointDef): string {
  const slug = `${endpoint.method} ${endpoint.path}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "operation";
}

interface ResponseBucket {
  descriptions: string[];
  examples: Record<string, { summary: string; value: unknown }>;
  headers: Record<string, string>;
}

function bucketFor(
  buckets: Map<string, ResponseBucket>,
  status: number,
): ResponseBucket {
  const key = String(status);
  const existing = buckets.get(key);
  if (existing) return existing;
  const created: ResponseBucket = { descriptions: [], examples: {}, headers: {} };
  buckets.set(key, created);
  return created;
}

function addScenario(buckets: Map<string, ResponseBucket>, scenario: ResponseScenario): void {
  const bucket = bucketFor(buckets, scenario.status);
  bucket.descriptions.push(scenario.description?.trim() || scenario.name);
  bucket.examples[scenario.name] = {
    summary: scenario.description?.trim() || scenario.name,
    value: scenario.body,
  };
  Object.assign(bucket.headers, scenario.headers);
}

function responsesObject(endpoint: EndpointDef): Record<string, unknown> {
  const buckets = new Map<string, ResponseBucket>();
  const scenarios = endpoint.scenarios.filter((scenario) => scenario.enabled);
  const fallback = scenarios.find((scenario) => scenario.isDefault) ?? scenarios[0];

  if (fallback) addScenario(buckets, fallback);
  for (const scenario of scenarios) {
    if (scenario !== fallback) addScenario(buckets, scenario);
  }

  const validation = endpoint.validationError;
  const validationBucket = bucketFor(buckets, validation.status);
  validationBucket.descriptions.push("Request validation failed");
  validationBucket.examples["Validation error"] = {
    summary: "One or more registered rules rejected the request",
    value: validation.body,
  };

  if (endpoint.auth.type !== "none") {
    const authBucket = bucketFor(buckets, endpoint.authError.status);
    authBucket.descriptions.push("Missing or invalid credentials");
    authBucket.examples["Auth error"] = {
      summary: "The endpoint credentials were missing or wrong",
      value: endpoint.authError.body,
    };
  }

  const responses: Record<string, unknown> = {};
  for (const [status, bucket] of buckets) {
    const names = Object.keys(bucket.examples);
    const media: Record<string, unknown> = {};
    if (names.length === 1) media.example = bucket.examples[names[0]].value;
    else media.examples = bucket.examples;

    const response: Record<string, unknown> = {
      description: bucket.descriptions.join(" / ") || `HTTP ${status}`,
      content: { [endpoint.responseContentType]: media },
    };

    const headerNames = Object.keys(bucket.headers);
    if (headerNames.length > 0) {
      response.headers = Object.fromEntries(
        headerNames.map((name) => [
          name,
          { schema: { type: "string" }, example: bucket.headers[name] },
        ]),
      );
    }

    responses[status] = response;
  }

  return responses;
}

function requestBodyObject(endpoint: EndpointDef): Record<string, unknown> | null {
  if (!hasRequestBody(endpoint)) return null;
  const spec: RequestSpec = endpoint.request;

  if (!isStructuredContentType(spec.contentType)) {
    return {
      required: true,
      content: {
        [spec.contentType]: { schema: { type: "string" }, example: spec.sampleBody ?? "" },
      },
    };
  }

  const schema = {
    ...fieldsToJsonSchema(spec.body),
    additionalProperties: spec.allowUnknownFields,
  };
  const mediaType =
    spec.contentType === "application/x-www-form-urlencoded"
      ? "application/x-www-form-urlencoded"
      : "application/json";

  return {
    required: spec.body.some((field) => field.required),
    content: {
      [mediaType]: { schema, example: sampleObject(spec.body) },
    },
  };
}

function operationObject(endpoint: EndpointDef): Record<string, unknown> {
  const parameters: Array<Record<string, unknown>> = [
    ...pathParamNames(endpoint.path).map((name) => ({
      name,
      in: "path",
      required: true,
      description: `Path parameter ":${name}" of ${endpoint.path}`,
      schema: { type: "string" },
      example: samplePathParam(name),
    })),
    ...endpoint.request.query.map((field) => parameterObject(field, "query")),
    ...endpoint.request.headers.map((field) => parameterObject(field, "header")),
  ];

  const operation: Record<string, unknown> = {
    operationId: operationId(endpoint),
    summary: endpoint.name,
    responses: responsesObject(endpoint),
  };

  if (endpoint.description) operation.description = endpoint.description;
  if (endpoint.tags.length > 0) operation.tags = [...endpoint.tags];
  if (parameters.length > 0) operation.parameters = parameters;
  if (!endpoint.enabled) operation.deprecated = true;

  const body = requestBodyObject(endpoint);
  if (body) operation.requestBody = body;

  const scheme = securitySchemeName(endpoint.auth);
  if (scheme) operation.security = [{ [scheme]: [] }];

  return operation;
}

/** OpenAPI 3.1 document for one project. */
export function toOpenApi(
  project: ProjectDef,
  endpoints: EndpointDef[],
  origin: string,
): unknown {
  const paths: Record<string, Record<string, unknown>> = {};
  const securitySchemes: Record<string, unknown> = {};
  const tags = new Set<string>();

  for (const endpoint of endpoints) {
    const key = openApiPath(endpoint.path);
    const item = paths[key] ?? {};
    item[endpoint.method.toLowerCase()] = operationObject(endpoint);
    paths[key] = item;

    const scheme = securitySchemeName(endpoint.auth);
    if (scheme && !(scheme in securitySchemes)) {
      securitySchemes[scheme] = securityScheme(endpoint.auth);
    }
    for (const tag of endpoint.tags) tags.add(tag);
  }

  const document: Record<string, unknown> = {
    openapi: "3.1.0",
    info: {
      title: project.name,
      version: "1.0.0",
      description:
        project.description ||
        `Mock API Studio sandbox for ${project.name}. Every response is a registered scenario.`,
    },
    servers: [{ url: mockBase(project, origin), description: "Mock API Studio sandbox" }],
    paths,
  };

  if (tags.size > 0) document.tags = [...tags].map((name) => ({ name }));
  if (Object.keys(securitySchemes).length > 0) document.components = { securitySchemes };

  return document;
}

/* ------------------------------------------------------------------ *
 * Postman v2.1
 * ------------------------------------------------------------------ */

function postmanAuth(auth: AuthSpec): Record<string, unknown> | null {
  switch (auth.type) {
    case "apiKey":
      return {
        type: "apikey",
        apikey: [
          { key: "key", value: auth.headerName || "x-api-key", type: "string" },
          { key: "value", value: auth.token ?? "", type: "string" },
          { key: "in", value: "header", type: "string" },
        ],
      };
    case "bearer":
      return {
        type: "bearer",
        bearer: [{ key: "token", value: auth.token ?? "", type: "string" }],
      };
    case "basic":
      return {
        type: "basic",
        basic: [
          { key: "username", value: auth.username ?? "", type: "string" },
          { key: "password", value: auth.password ?? "", type: "string" },
        ],
      };
    default:
      return null;
  }
}

/** Postman's raw-body syntax highlighter language for a non-structured content type. */
function postmanRawLanguage(contentType: ContentType): string {
  switch (contentType) {
    case "text/xml":
    case "application/soap+xml":
    case "application/xml":
      return "xml";
    default:
      return "text";
  }
}

function postmanBody(endpoint: EndpointDef): Record<string, unknown> | null {
  if (!hasRequestBody(endpoint)) return null;

  if (!isStructuredContentType(endpoint.request.contentType)) {
    return {
      mode: "raw",
      raw: endpoint.request.sampleBody ?? "",
      options: { raw: { language: postmanRawLanguage(endpoint.request.contentType) } },
    };
  }

  const sample = sampleObject(endpoint.request.body);

  if (endpoint.request.contentType === "application/x-www-form-urlencoded") {
    return {
      mode: "urlencoded",
      urlencoded: Object.entries(sample).map(([key, value]) => ({
        key,
        value: typeof value === "string" ? value : JSON.stringify(value),
        type: "text",
      })),
    };
  }

  return {
    mode: "raw",
    raw: JSON.stringify(sample, null, 2),
    options: { raw: { language: "json" } },
  };
}

function postmanItem(endpoint: EndpointDef): Record<string, unknown> {
  const segments = endpoint.path.split("/").filter((segment) => segment !== "");
  const query = endpoint.request.query.map((field) => ({
    key: field.name,
    value: String(sampleValue(field) ?? ""),
    description: field.description ?? "",
    disabled: !field.required,
  }));

  const headers: Array<Record<string, unknown>> = endpoint.request.headers.map((field) => ({
    key: field.name,
    value: String(sampleValue(field) ?? ""),
    description: field.description ?? "",
    type: "text",
    disabled: !field.required,
  }));

  if (hasRequestBody(endpoint)) {
    headers.unshift({ key: "content-type", value: endpoint.request.contentType, type: "text" });
  }

  const enabledQuery = query.filter((entry) => !entry.disabled);
  const rawQuery =
    enabledQuery.length > 0
      ? `?${enabledQuery.map((entry) => `${entry.key}=${encodeURIComponent(entry.value)}`).join("&")}`
      : "";

  const url: Record<string, unknown> = {
    raw: `{{baseUrl}}${endpoint.path}${rawQuery}`,
    host: ["{{baseUrl}}"],
    path: segments,
  };
  if (query.length > 0) url.query = query;

  const variables = pathParamNames(endpoint.path).map((name) => ({
    key: name,
    value: samplePathParam(name),
    description: `Path parameter of ${endpoint.path}`,
  }));
  if (variables.length > 0) url.variable = variables;

  const request: Record<string, unknown> = {
    method: endpoint.method,
    header: headers,
    url,
  };
  if (endpoint.description) request.description = endpoint.description;

  const auth = postmanAuth(endpoint.auth);
  if (auth) request.auth = auth;

  const body = postmanBody(endpoint);
  if (body) request.body = body;

  return { name: endpoint.name, request, response: [] };
}

/** Postman v2.1 collection - import it straight into Postman or Insomnia. */
export function toPostman(
  project: ProjectDef,
  endpoints: EndpointDef[],
  origin: string,
): unknown {
  return {
    info: {
      _postman_id: uuid(),
      name: project.name,
      description:
        project.description ||
        `Mock API Studio sandbox for ${project.name}. Base URL is the {{baseUrl}} variable.`,
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    variable: [{ key: "baseUrl", value: mockBase(project, origin), type: "string" }],
    item: endpoints.map(postmanItem),
  };
}
