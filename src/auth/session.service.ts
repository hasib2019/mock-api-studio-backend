/**
 * Studio session handling - signed cookie, no session store. Ported from the
 * original Next.js studio's `src/lib/auth.ts`; the crypto and cookie-shape
 * logic is unchanged, only the cookie jar (Express's `req`/`res` instead of
 * `next/headers`) and the redirect-to-login behaviour (that lived here only
 * because it doubled as a React Server Component helper) are gone - this
 * backend never renders a page, so `AuthGuard` throws `UnauthorizedException`
 * instead.
 */
import crypto from "node:crypto";

import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { CookieOptions, Request } from "express";

import type { SessionPayload, StudioUser } from "../common/types";

export const SESSION_COOKIE = "mas_session";

/** 12 hours. */
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

const DEV_SECRET = "mock-api-studio-dev-secret-do-not-use-in-production";

@Injectable()
export class SessionService {
  private warnedAboutSecret = false;

  constructor(private readonly config: ConfigService) {}

  private secret(): string {
    const fromEnv = this.config.get<string>("SESSION_SECRET");
    if (fromEnv && fromEnv.length > 0) return fromEnv;

    if (this.config.get<string>("NODE_ENV") === "production" && !this.warnedAboutSecret) {
      this.warnedAboutSecret = true;
      console.warn(
        "[auth] SESSION_SECRET is not set - falling back to the built-in development secret. " +
          "Set SESSION_SECRET before running this in production.",
      );
    }
    return DEV_SECRET;
  }

  private signBody(body: string): string {
    return crypto.createHmac("sha256", this.secret()).update(body).digest("base64url");
  }

  signSession(payload: SessionPayload): string {
    const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    return `${body}.${this.signBody(body)}`;
  }

  private toSessionPayload(value: unknown): SessionPayload | null {
    if (typeof value !== "object" || value === null) return null;
    const record = value as Record<string, unknown>;
    const { sub, username, name, role, exp } = record;

    if (typeof sub !== "string" || sub === "") return null;
    if (typeof username !== "string" || username === "") return null;
    if (typeof name !== "string") return null;
    if (role !== "admin" && role !== "member") return null;
    if (typeof exp !== "number" || !Number.isFinite(exp)) return null;

    return { sub, username, name, role, exp };
  }

  verifySession(token: string | undefined): SessionPayload | null {
    if (!token) return null;

    const separator = token.indexOf(".");
    if (separator <= 0 || separator === token.length - 1) return null;

    const body = token.slice(0, separator);
    const signature = Buffer.from(token.slice(separator + 1), "utf8");
    const expected = Buffer.from(this.signBody(body), "utf8");
    if (signature.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(signature, expected)) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    } catch {
      return null;
    }

    const payload = this.toSessionPayload(parsed);
    if (!payload) return null;
    if (payload.exp <= Math.floor(Date.now() / 1000)) return null;

    return payload;
  }

  /** Builds the payload signed into the cookie for a freshly authenticated user. */
  newSessionPayload(user: StudioUser): SessionPayload {
    return {
      sub: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    };
  }

  /**
   * A cookie marked `Secure` is only stored/sent by the browser over HTTPS (or
   * from `localhost`). This process itself never terminates TLS - the Next.js
   * frontend proxies to it server-to-server - so `NODE_ENV` alone cannot tell
   * us whether the browser's connection was actually encrypted. Trust
   * `X-Forwarded-Proto` first (set by whatever edge terminates TLS in front of
   * the proxy chain), falling back to the request's own protocol.
   */
  isSecureRequest(request: Request): boolean {
    const forwardedProto = request.headers["x-forwarded-proto"];
    if (forwardedProto) {
      const first = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
      return first.split(",")[0]?.trim() === "https";
    }
    return request.protocol === "https";
  }

  cookieOptions(maxAge: number, secure: boolean): CookieOptions {
    return {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure,
      maxAge: maxAge * 1000, // express-style cookie options take milliseconds
    };
  }
}
