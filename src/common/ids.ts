/** Id + slug helpers. Safe on both the server and the browser. */

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

function randomBytes(len: number): Uint8Array {
  const out = new Uint8Array(len);
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === "function") {
    c.getRandomValues(out);
    return out;
  }
  for (let i = 0; i < len; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

/** Short, url-safe, sortable-enough id. `newId("ep")` => "ep_lz3k9a2f7b". */
export function newId(prefix?: string): string {
  const bytes = randomBytes(8);
  let body = "";
  for (const b of bytes) body += ALPHABET[b % ALPHABET.length];
  const stamp = Date.now().toString(36);
  const id = `${stamp}${body}`;
  return prefix ? `${prefix}_${id}` : id;
}

export function uuid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** "NPSB Transfer API" => "npsb-transfer-api" */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Normalises "accounts/:id " => "/accounts/:id" */
export function normalizePath(input: string): string {
  const trimmed = (input || "").trim().replace(/\s+/g, "");
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const noTrailing =
    withSlash.length > 1 ? withSlash.replace(/\/+$/, "") : withSlash;
  return noTrailing.replace(/\/{2,}/g, "/");
}
