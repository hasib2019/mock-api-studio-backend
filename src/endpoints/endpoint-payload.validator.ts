/**
 * Structural validation for the endpoint definition the studio posts back on
 * every save - ported unchanged (logic-for-logic) from the original Next.js
 * studio's `src/lib/http.ts`. Keys the runtime does not recognise are never
 * dropped; the record stays the user's.
 */
import { isRecord, text } from "../common/http";
import { StoreError } from "../common/store-error";
import { CONTENT_TYPES, FIELD_TYPES, HTTP_METHODS } from "../common/types";
import type { EndpointDef, EndpointInput } from "../common/types";

const FIELD_TYPE_SET = new Set<string>(FIELD_TYPES);
const CONTENT_TYPE_SET = new Set<string>(CONTENT_TYPES);
const VALIDATION_MODES = new Set<string>(["collectAll", "failFast"]);
const FIELD_LOCATIONS = ["body", "query", "headers"] as const;

/** Rejects the request with a 400 carrying a message the studio can display. */
function bad(message: string): never {
  throw new StoreError(message, 400);
}

function checkFields(value: unknown, trail: string): void {
  if (!Array.isArray(value)) bad(`"${trail}" must be an array of fields`);

  value.forEach((entry, index) => {
    const at = `${trail}[${index}]`;
    if (!isRecord(entry)) bad(`${at} must be an object`);

    const name = text(entry.name);
    if (!name) bad(`Every field needs a name (${at})`);

    if (entry.type !== undefined && !FIELD_TYPE_SET.has(String(entry.type))) {
      bad(`Field "${name}" has an unknown type "${String(entry.type)}"`);
    }
    if (entry.rules !== undefined && !Array.isArray(entry.rules)) {
      bad(`Field "${name}" must carry its rules as an array`);
    }
    if (entry.children !== undefined) checkFields(entry.children, `${at}.children`);
  });
}

/** Validates statuses and settles which scenario is the default one. */
function normalizeScenarios(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) bad('"scenarios" must be an array');

  const scenarios = value.map((entry, index) => {
    if (!isRecord(entry)) bad(`Scenario [${index}] must be an object`);

    const label = text(entry.name) || `[${index}]`;
    const status = entry.status;
    if (typeof status !== "number" || !Number.isInteger(status) || status < 100 || status > 599) {
      bad(`Scenario "${label}" needs an HTTP status between 100 and 599`);
    }
    if (entry.conditions !== undefined && !Array.isArray(entry.conditions)) {
      bad(`Scenario "${label}" must carry its conditions as an array`);
    }
    return { ...entry, isDefault: entry.isDefault === true };
  });

  const flagged = scenarios.filter((scenario) => scenario.isDefault);
  if (flagged.length > 1) bad("Only one scenario can be marked as the default");
  if (flagged.length === 0 && scenarios.length > 0) scenarios[0].isDefault = true;

  return scenarios;
}

function normalizeEndpointPayload(raw: unknown, partial: boolean): Record<string, unknown> {
  if (!isRecord(raw)) bad("Request body must be a JSON object");

  const draft: Record<string, unknown> = { ...raw };
  delete draft.createdAt;
  delete draft.updatedAt;

  const given = (key: string): boolean => draft[key] !== undefined;
  const wanted = (key: string): boolean => !partial || given(key);

  if (wanted("projectId")) {
    const projectId = text(draft.projectId);
    if (!projectId) bad("An endpoint needs a projectId");
    draft.projectId = projectId;
  }

  if (wanted("name")) {
    const name = text(draft.name);
    if (!name) bad("Endpoint name is required");
    draft.name = name;
  }

  if (wanted("method")) {
    const method = HTTP_METHODS.find((known) => known === text(draft.method).toUpperCase());
    if (!method) bad(`Method must be one of ${HTTP_METHODS.join(", ")}`);
    draft.method = method;
  }

  if (wanted("path")) {
    const path = text(draft.path);
    if (!path) bad("Endpoint path is required");
    if (!path.startsWith("/")) bad('Endpoint path must start with "/" (e.g. "/accounts/:id")');
    draft.path = path;
  }

  if (given("request")) {
    const request = draft.request;
    if (!isRecord(request)) bad('"request" must be an object');
    for (const location of FIELD_LOCATIONS) {
      if (request[location] !== undefined) checkFields(request[location], `request.${location}`);
    }
    if (request.contentType !== undefined && !CONTENT_TYPE_SET.has(String(request.contentType))) {
      bad(`Unsupported content type "${String(request.contentType)}"`);
    }
    if (
      request.validationMode !== undefined &&
      !VALIDATION_MODES.has(String(request.validationMode))
    ) {
      bad('Validation mode must be "collectAll" or "failFast"');
    }
    if (request.sampleBody !== undefined && typeof request.sampleBody !== "string") {
      bad('"request.sampleBody" must be a string');
    }
  }

  if (wanted("responseContentType")) {
    const responseContentType = draft.responseContentType;
    if (responseContentType !== undefined && !CONTENT_TYPE_SET.has(String(responseContentType))) {
      bad(`Unsupported response content type "${String(responseContentType)}"`);
    }
  }

  if (given("scenarios")) draft.scenarios = normalizeScenarios(draft.scenarios);

  if (given("delayMs")) {
    const delay = draft.delayMs;
    if (typeof delay !== "number" || !Number.isFinite(delay) || delay < 0) {
      bad("delayMs must be a positive number of milliseconds");
    }
  }

  if (given("tags") && !Array.isArray(draft.tags)) bad('"tags" must be an array of strings');

  return draft;
}

/** Full definition for `POST /api/admin/endpoints`. Throws a 400 `StoreError`. */
export function validateEndpointInput(raw: unknown): EndpointInput {
  return normalizeEndpointPayload(raw, false) as unknown as EndpointInput;
}

/** Partial definition for `PUT /api/admin/endpoints/:endpointId`. */
export function validateEndpointPatch(raw: unknown): Partial<EndpointDef> {
  const draft = normalizeEndpointPayload(raw, true);
  delete draft.id;
  return draft as unknown as Partial<EndpointDef>;
}
