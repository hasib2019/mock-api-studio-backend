/**
 * Small pure helpers shared by `ProjectsService` and `EndpointsService` -
 * ported unchanged from the original Next.js studio's `src/lib/store.ts`.
 */
import { HTTP_METHODS } from "./types";
import type { HttpMethod } from "./types";
import { StoreError } from "./store-error";

/** Record ids double as a natural key elsewhere (exports, urls), so keep them boring. */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;

export function validId(id: string): string | null {
  return ID_PATTERN.test(id) ? id : null;
}

export function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function stripUndefined<T extends object>(patch: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) out[key] = value;
  }
  return out as unknown as T;
}

export function cloneJson<T>(value: T): T {
  if (value === undefined) return value;
  const json = JSON.stringify(value);
  return json === undefined ? value : (JSON.parse(json) as T);
}

export function methodOrNull(value: unknown): HttpMethod | null {
  if (typeof value !== "string") return null;
  const upper = value.trim().toUpperCase();
  return HTTP_METHODS.find((method) => method === upper) ?? null;
}

export function parseMethod(value: unknown, fallback: HttpMethod): HttpMethod {
  if (value === undefined || value === null || value === "") return fallback;
  const method = methodOrNull(value);
  if (!method) throw new StoreError(`Unsupported HTTP method "${String(value)}"`, 400);
  return method;
}

export function requireText(value: unknown, label: string): string {
  const text = str(value).trim();
  if (!text) throw new StoreError(`${label} is required`, 400);
  return text;
}
