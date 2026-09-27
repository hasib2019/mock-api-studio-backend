/**
 * `/api/auth/*` - ported from the original Next.js studio's
 * `src/app/api/auth/{login,logout,me}/route.ts`.
 *
 * All three handlers take the request/response directly (`@Res()`, no
 * `passthrough`) rather than going through `ApiEnvelopeInterceptor` /
 * `AllExceptionsFilter`: login needs a custom status + a `retry-after` header
 * on the lockout branch and a `Set-Cookie` on success, so it is simplest (and
 * lowest-risk for an exact behavioural match) to build the same
 * `ApiResponse<T>` envelope by hand here, exactly as the original did with
 * `NextResponse.json(...)`.
 */
import { Controller, Get, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";

import { AuthGuard } from "./auth.guard";
import { CurrentSession } from "./current-session.decorator";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, SessionService } from "./session.service";
import { UsersService } from "../users/users.service";
import type { ApiResponse as StudioApiResponse, SessionPayload, UserRole } from "../common/types";

interface LoginData {
  username: string;
  name: string;
  role: UserRole;
}

/* ------------------------------------------------------------------ *
 * Failed-attempt throttle (in memory, per username)
 * ------------------------------------------------------------------ */

const MAX_FAILURES = 10;
const WINDOW_MS = 5 * 60 * 1000;

interface FailureWindow {
  count: number;
  resetAt: number;
}

const failures = new Map<string, FailureWindow>();

function prune(now: number): void {
  for (const [key, window] of failures) {
    if (window.resetAt <= now) failures.delete(key);
  }
}

/** Milliseconds left on the lockout, or 0 when the caller may try again. */
function lockoutRemaining(key: string, now: number): number {
  const window = failures.get(key);
  if (!window || window.resetAt <= now) return 0;
  return window.count >= MAX_FAILURES ? window.resetAt - now : 0;
}

function recordFailure(key: string, now: number): void {
  const window = failures.get(key);
  if (!window || window.resetAt <= now) {
    failures.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  window.count += 1;
}

function readCredentials(raw: unknown): { username: string; password: string } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const { username, password } = record;
  if (typeof username !== "string" || typeof password !== "string") return null;
  const trimmed = username.trim();
  if (trimmed === "" || password === "") return null;
  return { username: trimmed, password };
}

@Controller("api/auth")
export class AuthController {
  constructor(
    private readonly sessions: SessionService,
    private readonly users: UsersService,
  ) {}

  @Post("login")
  async login(@Req() request: Request, @Res() res: Response): Promise<void> {
    const credentials = readCredentials(request.body);
    if (!credentials) {
      res
        .status(400)
        .json({ ok: false, error: "Username and password are required." } satisfies StudioApiResponse<LoginData>);
      return;
    }

    const now = Date.now();
    prune(now);

    const key = credentials.username.toLowerCase();
    const remaining = lockoutRemaining(key, now);
    if (remaining > 0) {
      const minutes = Math.max(1, Math.ceil(remaining / 60_000));
      res
        .status(429)
        .header("retry-after", String(Math.ceil(remaining / 1000)))
        .json({
          ok: false,
          error: `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
        } satisfies StudioApiResponse<LoginData>);
      return;
    }

    await this.users.ensureSeedUser();
    const user = await this.users.verifyCredentials(credentials.username, credentials.password);

    if (!user) {
      recordFailure(key, now);
      res
        .status(401)
        .json({ ok: false, error: "Invalid username or password" } satisfies StudioApiResponse<LoginData>);
      return;
    }

    failures.delete(key);

    const token = this.sessions.signSession(this.sessions.newSessionPayload(user));
    res.cookie(
      SESSION_COOKIE,
      token,
      this.sessions.cookieOptions(SESSION_TTL_SECONDS, this.sessions.isSecureRequest(request)),
    );
    res.status(200).json({
      ok: true,
      data: { username: user.username, name: user.name, role: user.role },
    } satisfies StudioApiResponse<LoginData>);
  }

  @Post("logout")
  logout(@Req() request: Request, @Res() res: Response): void {
    res.cookie(SESSION_COOKIE, "", {
      ...this.sessions.cookieOptions(0, this.sessions.isSecureRequest(request)),
      expires: new Date(0),
    });
    res.status(200).json({ ok: true, data: { ok: true } } satisfies StudioApiResponse<{ ok: true }>);
  }

  /**
   * Unlike login/logout above, this one goes through the normal pipeline
   * (`ApiEnvelopeInterceptor` wraps it as `{ ok: true, data: session }`,
   * `AllExceptionsFilter` turns `AuthGuard`'s `UnauthorizedException` into
   * `{ ok: false, error: "Unauthorized" }`) - it needs no response
   * side-effect `@Res()` would be for, so it stays consistent with every
   * other guarded controller instead of building the envelope by hand.
   */
  @Get("me")
  @UseGuards(AuthGuard)
  me(@CurrentSession() session: SessionPayload): SessionPayload {
    return session;
  }
}
