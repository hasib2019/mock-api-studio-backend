import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";

import { SESSION_COOKIE, SessionService } from "./session.service";
import type { SessionPayload } from "../common/types";

/**
 * Equivalent to the original studio's `guard()` + `fail("Unauthorized", 401)`
 * pair, repeated at the top of every admin route. Attaches the verified
 * session onto `request.session` for `@CurrentSession()` to read.
 *
 * The two admin-only checks ("Only an admin can create/delete users") are not
 * a second guard: each carries its own message in the original, so they stay
 * as a plain `if (session.role !== "admin") throw ...` inside those two
 * controller methods rather than behind a generic, message-less guard.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { session?: SessionPayload }>();
    const session = this.sessions.verifySession(request.cookies?.[SESSION_COOKIE]);
    if (!session) throw new UnauthorizedException("Unauthorized");
    request.session = session;
    return true;
  }
}
