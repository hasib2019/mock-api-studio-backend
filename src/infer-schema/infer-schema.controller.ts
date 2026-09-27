/**
 * `/api/admin/infer-schema` - ported from the original Next.js studio's
 * `src/app/api/admin/infer-schema/route.ts`. Stateless (no database), so this
 * is a controller only, no service.
 */
import { Body, Controller, Post, UseGuards } from "@nestjs/common";

import { AuthGuard } from "../auth/auth.guard";
import { isRecord } from "../common/http";
import { StoreError } from "../common/store-error";
import { newField, newRule } from "../common/defaults";
import type { FieldDef, FieldType, IssueLocation, ValidationRule } from "../common/types";

/* ------------------------------------------------------------------ *
 * Shape sniffing
 * ------------------------------------------------------------------ */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d{1,6})?(Z|[+-]\d{2}:?\d{2})?)?$/;
/** Bangladeshi mobile number as it arrives in a sample payload. */
const MOBILE = /^01\d{9}$/;
const MOBILE_PATTERN = "^01[3-9]\\d{8}$";

/** Obvious starter rules, so the builder opens with something useful. */
function starterRules(value: string): ValidationRule[] {
  if (EMAIL.test(value)) return [newRule("email")];
  if (UUID.test(value)) return [newRule("uuid")];
  if (ISO_DATE.test(value)) return [newRule("date")];
  if (MOBILE.test(value)) return [newRule("pattern", MOBILE_PATTERN)];
  return [];
}

function typeOf(value: unknown): FieldType {
  if (typeof value === "string") return "string";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  if (typeof value === "boolean") return "boolean";
  if (Array.isArray(value)) return "array";
  if (isRecord(value)) return "object";
  return "any";
}

function fieldFor(name: string, value: unknown): FieldDef {
  const type = typeOf(value);

  if (type === "object") {
    return newField({ name, type: "object", required: true, example: value, children: inferFields(value) });
  }

  if (type === "array") {
    const items = value as unknown[];
    const first = items.length > 0 ? items[0] : undefined;
    const itemType: FieldType = items.length > 0 ? typeOf(first) : "string";
    return newField({
      name,
      type: "array",
      required: true,
      example: value,
      itemType,
      children: itemType === "object" ? inferFields(first) : [],
    });
  }

  return newField({
    name,
    type,
    required: true,
    example: value,
    rules: typeof value === "string" ? starterRules(value) : [],
  });
}

function inferFields(sample: unknown): FieldDef[] {
  if (!isRecord(sample)) return [];
  return Object.entries(sample).map(([name, value]) => fieldFor(name, value));
}

/* ------------------------------------------------------------------ *
 * Handler
 * ------------------------------------------------------------------ */

const LOCATIONS: IssueLocation[] = ["body", "query", "headers", "path", "auth"];

function readLocation(value: unknown): IssueLocation | null {
  if (value === undefined || value === null || value === "") return "body";
  return LOCATIONS.find((location) => location === value) ?? null;
}

@Controller("api/admin/infer-schema")
@UseGuards(AuthGuard)
export class InferSchemaController {
  @Post()
  infer(@Body() body: unknown): FieldDef[] {
    if (!isRecord(body)) throw new StoreError("Request body must be a JSON object", 400);

    const location = readLocation(body.location);
    if (!location) throw new StoreError(`Unknown location "${String(body.location)}"`, 400);

    // An array sample describes one item, so infer from its first object.
    const sample = Array.isArray(body.sample)
      ? body.sample.find((entry: unknown) => isRecord(entry))
      : body.sample;

    if (!isRecord(sample)) {
      throw new StoreError("Sample must be a JSON object, or an array of JSON objects", 400);
    }

    return inferFields(sample).map((field) =>
      location === "headers" ? { ...field, name: field.name.toLowerCase() } : field,
    );
  }
}
