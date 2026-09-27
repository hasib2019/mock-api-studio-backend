/**
 * Small shared guards used across the admin controllers - ported from the
 * original Next.js studio's `src/lib/http.ts`.
 */
import type { Request } from "express";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function headerMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") out[key] = entry;
  }
  return out;
}

export function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Express's `qs` parser reads a query param as `string | string[] | undefined`; keep the first. */
export function queryParam(value: unknown): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return trimmed ? trimmed : undefined;
}

function firstForwarded(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.split(",")[0]?.trim() || undefined;
}

/**
 * The origin a caller can actually reach this app at - trusts
 * `x-forwarded-proto`/`x-forwarded-host` first (set by the Next.js frontend's
 * `proxy.ts` before it rewrites to this backend, mirroring the original
 * Next.js studio's `isSecureRequest()` in `src/lib/auth.ts`), falling back to
 * this request's own protocol/host for local development against the backend
 * directly.
 */
export function publicOrigin(request: Request): string {
  const proto = firstForwarded(request.headers["x-forwarded-proto"]) ?? request.protocol;
  const host = firstForwarded(request.headers["x-forwarded-host"]) ?? request.get("host") ?? "";
  return `${proto}://${host}`;
}
