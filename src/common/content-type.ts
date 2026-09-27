/**
 * Structured vs. raw content types.
 *
 * "Structured" means the runtime parses the body into a JS value and the
 * builder edits it as a FieldDef tree / JSON template. Everything else (XML,
 * SOAP, plain text, ...) is carried as an opaque string end to end - no
 * parsing, no FieldDef validation, no JSON.stringify on the way out.
 *
 * Browser-safe: imported by both the mock runtime and the builder UI.
 */

import { CONTENT_TYPES, type ContentType } from "./types";

const STRUCTURED: ReadonlySet<ContentType> = new Set([
  "application/json",
  "application/x-www-form-urlencoded",
]);

export function isStructuredContentType(contentType: ContentType): boolean {
  return STRUCTURED.has(contentType);
}

/** Content types offered for a *response* - "none" only makes sense for a request body. */
export const RESPONSE_CONTENT_TYPES: ContentType[] = CONTENT_TYPES.filter(
  (contentType) => contentType !== "none",
);
