/**
 * Factory helpers for brand-new records.
 *
 * Shared by the builder UI, the admin API and the seed script so that every
 * endpoint starts from exactly the same shape.
 */

import { isStructuredContentType } from "./content-type";
import { newId } from "./ids";
import type {
  Condition,
  ContentType,
  EndpointDef,
  ErrorTemplate,
  FieldDef,
  FieldType,
  HttpMethod,
  ProjectDef,
  RequestSpec,
  ResponseScenario,
  RuleId,
  ValidationRule,
} from "./types";

export function newRule(rule: RuleId, value?: ValidationRule["value"]): ValidationRule {
  return { id: newId("r"), rule, value, enabled: true };
}

export function newField(partial: Partial<FieldDef> = {}): FieldDef {
  const type: FieldType = partial.type ?? "string";
  return {
    id: newId("f"),
    name: partial.name ?? "",
    label: partial.label,
    type,
    required: partial.required ?? false,
    description: partial.description,
    example: partial.example,
    defaultValue: partial.defaultValue,
    rules: partial.rules ?? [],
    children: partial.children ?? [],
    itemType: partial.itemType ?? (type === "array" ? "string" : undefined),
  };
}

export function newCondition(partial: Partial<Condition> = {}): Condition {
  return {
    id: newId("c"),
    source: partial.source ?? "body",
    path: partial.path ?? "",
    operator: partial.operator ?? "eq",
    value: partial.value ?? "",
  };
}

export function defaultSuccessBody(): unknown {
  return {
    status: "SUCCESS",
    responseCode: "0000",
    message: "Request processed successfully",
    data: {},
    requestId: "{{uuid}}",
    timestamp: "{{now}}",
  };
}

/** Starter SOAP 1.1 success envelope, used when a scenario's response is XML. */
export function defaultSoapEnvelope(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <Response>
      <status>SUCCESS</status>
      <requestId>{{uuid}}</requestId>
      <timestamp>{{now}}</timestamp>
    </Response>
  </soap:Body>
</soap:Envelope>`;
}

export function newScenario(partial: Partial<ResponseScenario> = {}): ResponseScenario {
  return {
    id: newId("s"),
    name: partial.name ?? "Success",
    description: partial.description,
    isDefault: partial.isDefault ?? false,
    enabled: partial.enabled ?? true,
    conditions: partial.conditions ?? [],
    status: partial.status ?? 200,
    headers: partial.headers ?? {},
    body: partial.body ?? defaultSuccessBody(),
    delayMs: partial.delayMs ?? 0,
  };
}

/** SOAP 1.1 Fault envelope, used as the non-JSON default error body. */
function soapFault(faultstring: string, detail: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <soap:Fault>
      <faultcode>soap:Client</faultcode>
      <faultstring>${faultstring}</faultstring>
      <detail>${detail}</detail>
    </soap:Fault>
  </soap:Body>
</soap:Envelope>`;
}

export function defaultValidationError(
  responseContentType: ContentType = "application/json",
): ErrorTemplate {
  if (!isStructuredContentType(responseContentType)) {
    return {
      status: 422,
      headers: {},
      body: soapFault(
        "Request validation failed",
        "<errorCount>{{errorCount}}</errorCount>",
      ),
    };
  }
  return {
    status: 422,
    headers: {},
    body: {
      status: "FAILED",
      responseCode: "VALIDATION_ERROR",
      message: "Request validation failed",
      errorCount: "{{errorCount}}",
      errors: "{{errors}}",
      requestId: "{{uuid}}",
      timestamp: "{{now}}",
    },
  };
}

export function defaultAuthError(
  responseContentType: ContentType = "application/json",
): ErrorTemplate {
  if (!isStructuredContentType(responseContentType)) {
    return {
      status: 401,
      headers: {},
      body: soapFault("Missing or invalid credentials", "<requestId>{{uuid}}</requestId>"),
    };
  }
  return {
    status: 401,
    headers: {},
    body: {
      status: "FAILED",
      responseCode: "UNAUTHORIZED",
      message: "Missing or invalid credentials",
      requestId: "{{uuid}}",
      timestamp: "{{now}}",
    },
  };
}

export function defaultRequestSpec(partial: Partial<RequestSpec> = {}): RequestSpec {
  return {
    contentType: partial.contentType ?? "application/json",
    body: partial.body ?? [],
    query: partial.query ?? [],
    headers: partial.headers ?? [],
    allowUnknownFields: partial.allowUnknownFields ?? true,
    validationMode: partial.validationMode ?? "collectAll",
    sampleBody: partial.sampleBody ?? "",
  };
}

export function newEndpoint(projectId: string, partial: Partial<EndpointDef> = {}): EndpointDef {
  const now = new Date().toISOString();
  const method: HttpMethod = partial.method ?? "POST";
  const responseContentType: ContentType = partial.responseContentType ?? "application/json";
  return {
    id: partial.id ?? newId("ep"),
    projectId,
    name: partial.name ?? "Untitled endpoint",
    description: partial.description ?? "",
    method,
    path: partial.path ?? "/new-endpoint",
    enabled: partial.enabled ?? true,
    auth: partial.auth ?? { type: "none" },
    request: defaultRequestSpec(partial.request),
    responseContentType,
    scenarios: partial.scenarios ?? [newScenario({ isDefault: true })],
    validationError: partial.validationError ?? defaultValidationError(responseContentType),
    authError: partial.authError ?? defaultAuthError(responseContentType),
    delayMs: partial.delayMs ?? 0,
    tags: partial.tags ?? [],
    notes: partial.notes ?? "",
    createdAt: partial.createdAt ?? now,
    updatedAt: partial.updatedAt ?? now,
  };
}

export const PROJECT_COLORS = [
  "#2563eb",
  "#0891b2",
  "#059669",
  "#d97706",
  "#dc2626",
  "#7c3aed",
  "#db2777",
  "#475569",
];

export function newProject(partial: Partial<ProjectDef> = {}): ProjectDef {
  const now = new Date().toISOString();
  return {
    id: partial.id ?? newId("pr"),
    name: partial.name ?? "Untitled project",
    slug: partial.slug ?? "untitled",
    description: partial.description ?? "",
    defaultHeaders: partial.defaultHeaders ?? {},
    color: partial.color ?? PROJECT_COLORS[0],
    createdAt: partial.createdAt ?? now,
    updatedAt: partial.updatedAt ?? now,
  };
}
