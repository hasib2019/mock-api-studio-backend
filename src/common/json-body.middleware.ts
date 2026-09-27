import type { NextFunction, Request, Response } from "express";

/**
 * Parses `req.rawBody` (set by `rawBodyMiddleware`, which must run first) into
 * `req.body` for the admin/auth routes - a missing or malformed body becomes
 * `undefined` instead of a thrown error, exactly like `readJsonBody()` in the
 * original Next.js studio's `src/lib/http.ts`. Each handler's own validation
 * then reports its own specific message ("X is required") for an empty body,
 * rather than a generic parse error winning first.
 */
export function jsonBodyMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const raw = (req.rawBody ?? "").trim();
  if (!raw) {
    req.body = undefined;
    next();
    return;
  }
  try {
    req.body = JSON.parse(raw);
  } catch {
    req.body = undefined;
  }
  next();
}
