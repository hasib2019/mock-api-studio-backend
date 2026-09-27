import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from "@nestjs/common";
import type { Response } from "express";

import { StoreError } from "./store-error";
import type { ApiErr } from "./types";

/**
 * Turns anything thrown inside a controller/service into the studio's
 * `{ ok: false, error, issues? }` envelope - ported from the original
 * Next.js studio's `handleError()` in `src/lib/http.ts`, same precedence:
 * a domain `StoreError` first, a JSON parse failure second, anything else a
 * generic 500. Nest's own `HttpException` (thrown by the auth guard, or by a
 * controller for a one-off status) is handled the same way a plain
 * `fail(message, status)` call used to be.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger("api");

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof StoreError) {
      const body: ApiErr =
        exception.issues && exception.issues.length > 0
          ? { ok: false, error: exception.message, issues: exception.issues }
          : { ok: false, error: exception.message };
      response.status(exception.status).json(body);
      return;
    }

    if (exception instanceof HttpException) {
      response.status(exception.getStatus()).json({
        ok: false,
        error: messageOf(exception),
      } satisfies ApiErr);
      return;
    }

    // A malformed JSON body reaches here as a bare SyntaxError - see
    // `RawBodyMiddleware`/`jsonBody()`, which otherwise swallow it into an
    // empty body so each handler's own validation can give a better message.
    if (exception instanceof SyntaxError) {
      response.status(400).json({ ok: false, error: "Malformed JSON body" } satisfies ApiErr);
      return;
    }

    this.logger.error("Unexpected error", exception instanceof Error ? exception.stack : exception);
    const message = exception instanceof Error && exception.message ? exception.message : "Unexpected server error";
    response.status(500).json({ ok: false, error: message } satisfies ApiErr);
  }
}

/** Nest's built-in exceptions carry either a string or a `{ message }`-shaped body. */
function messageOf(exception: HttpException): string {
  const body = exception.getResponse();
  if (typeof body === "string") return body;
  if (isRecord(body)) {
    const message = body.message;
    if (typeof message === "string") return message;
    if (Array.isArray(message) && message.length > 0) return String(message[0]);
  }
  return exception.message;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
