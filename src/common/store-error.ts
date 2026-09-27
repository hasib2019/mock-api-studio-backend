import type { ValidationIssue } from "./types";

/**
 * A domain error a service throws for anything the caller did wrong (bad
 * input, a duplicate slug, a missing record, ...). `AllExceptionsFilter`
 * turns it into the `{ ok: false, error }` envelope at `status` - ported
 * unchanged from the original Next.js studio's `src/lib/store.ts`.
 */
export class StoreError extends Error {
  readonly status: number;
  readonly issues?: ValidationIssue[];

  constructor(message: string, status = 400, issues?: ValidationIssue[]) {
    super(message);
    this.name = "StoreError";
    this.status = status;
    this.issues = issues;
  }
}
