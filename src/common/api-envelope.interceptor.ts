import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { map, type Observable } from "rxjs";

import { RawResponse } from "./raw-response";
import type { ApiOk } from "./types";

/**
 * Wraps every controller's return value as `{ ok: true, data }` - the success
 * half of the envelope `AllExceptionsFilter` produces for the failure half.
 * Mirrors the original Next.js studio's `ok()` helper in `src/lib/http.ts`;
 * the HTTP status itself is set the normal Nest way (`@HttpCode(201)` etc.),
 * this only shapes the body.
 */
@Injectable()
export class ApiEnvelopeInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((data: unknown) => {
        if (data instanceof RawResponse) return data.body;
        return { ok: true, data } satisfies ApiOk<unknown>;
      }),
    );
  }
}
