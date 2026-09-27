import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

import type { SessionPayload } from "../common/types";

/** The session `AuthGuard` verified and attached to the request. Only valid behind `@UseGuards(AuthGuard)`. */
export const CurrentSession = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SessionPayload => {
    const request = ctx.switchToHttp().getRequest<Request & { session?: SessionPayload }>();
    // AuthGuard always runs first and throws otherwise, so this is never undefined in practice.
    return request.session as SessionPayload;
  },
);
