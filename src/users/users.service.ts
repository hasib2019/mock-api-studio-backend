/**
 * Studio users - the humans who sign in to Mock API Studio. Ported from the
 * original Next.js studio's `src/lib/users.ts`; only the storage calls change
 * (a TypeORM repository instead of raw `pg` queries against `studio_users`).
 */
import crypto from "node:crypto";

import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

import { StudioUserEntity } from "../database/entities/studio-user.entity";
import { isUniqueViolation } from "../database/pg-helpers";
import { withLock } from "../common/lock";
import { newId } from "../common/ids";
import type { StudioUser, UserRole } from "../common/types";

const PBKDF2_ITERATIONS = 120_000;
const PBKDF2_KEY_LENGTH = 64;
const PBKDF2_DIGEST = "sha512";
const SALT_BYTES = 16;

/** Every write to the users table goes through this lock key. */
const USERS_LOCK = "users";

const MIN_PASSWORD_LENGTH = 6;
const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;

/** Fixed salt used to burn the same CPU time when a username does not exist. */
const TIMING_SALT = Buffer.alloc(SALT_BYTES, 0x5a);

@Injectable()
export class UsersService {
  /** Flips once the table is known to hold at least one user. */
  private seeded = false;

  constructor(
    @InjectRepository(StudioUserEntity) private readonly repo: Repository<StudioUserEntity>,
    private readonly config: ConfigService,
  ) {}

  /* ------------------------------------------------------------------ *
   * Password hashing
   * ------------------------------------------------------------------ */

  /** pbkdf2-sha512 digest stored as `saltHex:hashHex`. */
  hashPassword(password: string): string {
    const salt = crypto.randomBytes(SALT_BYTES);
    const hash = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEY_LENGTH, PBKDF2_DIGEST);
    return `${salt.toString("hex")}:${hash.toString("hex")}`;
  }

  verifyPassword(password: string, stored: string): boolean {
    const separator = stored.indexOf(":");
    if (separator <= 0 || separator === stored.length - 1) return false;

    const saltHex = stored.slice(0, separator);
    const hashHex = stored.slice(separator + 1);
    if (!/^[0-9a-f]+$/i.test(saltHex) || !/^[0-9a-f]+$/i.test(hashHex)) return false;

    const expected = Buffer.from(hashHex, "hex");
    if (expected.length !== PBKDF2_KEY_LENGTH) return false;

    const actual = crypto.pbkdf2Sync(
      password,
      Buffer.from(saltHex, "hex"),
      PBKDF2_ITERATIONS,
      PBKDF2_KEY_LENGTH,
      PBKDF2_DIGEST,
    );
    return crypto.timingSafeEqual(actual, expected);
  }

  /** Keeps an unknown username as slow as a wrong password. */
  private burnHashingTime(password: string): void {
    crypto.pbkdf2Sync(password, TIMING_SALT, PBKDF2_ITERATIONS, PBKDF2_KEY_LENGTH, PBKDF2_DIGEST);
  }

  /* ------------------------------------------------------------------ *
   * Storage
   * ------------------------------------------------------------------ */

  private isStudioUser(value: unknown): value is StudioUser {
    if (typeof value !== "object" || value === null) return false;
    const record = value as Record<string, unknown>;
    return (
      typeof record.id === "string" &&
      typeof record.username === "string" &&
      typeof record.name === "string" &&
      (record.role === "admin" || record.role === "member") &&
      typeof record.passwordHash === "string" &&
      typeof record.createdAt === "string"
    );
  }

  private normalizeUsername(username: string): string {
    return username.trim().toLowerCase();
  }

  private sortUsers(users: StudioUser[]): StudioUser[] {
    return [...users].sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt) || a.username.localeCompare(b.username),
    );
  }

  private async readUsers(): Promise<StudioUser[]> {
    const rows = await this.repo.find();
    return rows.map((row) => row.data).filter((data): data is StudioUser => this.isStudioUser(data));
  }

  /* ------------------------------------------------------------------ *
   * Seed
   * ------------------------------------------------------------------ */

  /**
   * Creates the first admin user on first run. Cheap enough to call on every
   * request, and locked so concurrent boots cannot race.
   */
  async ensureSeedUser(): Promise<void> {
    if (this.seeded) return;
    await withLock(USERS_LOCK, async () => {
      if (this.seeded) return;

      const existing = await this.readUsers();
      if (existing.length > 0) {
        this.seeded = true;
        return;
      }

      const username = this.normalizeUsername(this.config.get<string>("ADMIN_USERNAME") || "admin") || "admin";
      const password = this.config.get<string>("ADMIN_PASSWORD") || "Era@1234!!";
      const admin: StudioUser = {
        id: newId("us"),
        username,
        name: "Administrator",
        role: "admin",
        passwordHash: this.hashPassword(password),
        createdAt: new Date().toISOString(),
      };
      try {
        await this.repo.insert({ id: admin.id, username: admin.username, data: admin });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
      this.seeded = true;
    });
  }

  /* ------------------------------------------------------------------ *
   * Queries
   * ------------------------------------------------------------------ */

  async listUsers(): Promise<StudioUser[]> {
    return this.sortUsers(await this.readUsers());
  }

  async getUserByUsername(u: string): Promise<StudioUser | null> {
    const wanted = this.normalizeUsername(u ?? "");
    if (!wanted) return null;
    const row = await this.repo.findOneBy({ username: wanted });
    return row && this.isStudioUser(row.data) ? row.data : null;
  }

  /* ------------------------------------------------------------------ *
   * Mutations
   * ------------------------------------------------------------------ */

  async createUser(input: {
    username: string;
    name: string;
    password: string;
    role: UserRole;
  }): Promise<StudioUser> {
    const username = this.normalizeUsername(input.username ?? "");
    if (!USERNAME_PATTERN.test(username)) {
      throw new Error(
        "Username must be 3-32 characters long and may contain letters, digits, dot, dash or underscore.",
      );
    }
    if (typeof input.password !== "string" || input.password.length < MIN_PASSWORD_LENGTH) {
      throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    }
    if (input.role !== "admin" && input.role !== "member") {
      throw new Error("Role must be admin or member.");
    }

    const name = (input.name ?? "").trim() || username;
    const passwordHash = this.hashPassword(input.password);

    return withLock(USERS_LOCK, async () => {
      const existing = await this.getUserByUsername(username);
      if (existing) {
        throw new Error(`Username "${username}" is already taken.`);
      }
      const user: StudioUser = {
        id: newId("us"),
        username,
        name,
        role: input.role,
        passwordHash,
        createdAt: new Date().toISOString(),
      };
      try {
        await this.repo.insert({ id: user.id, username: user.username, data: user });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new Error(`Username "${username}" is already taken.`);
        }
        throw error;
      }
      this.seeded = true;
      return user;
    });
  }

  async deleteUser(id: string): Promise<void> {
    await withLock(USERS_LOCK, async () => {
      const users = await this.readUsers();
      const target = users.find((user) => user.id === id);
      if (!target) throw new Error("User not found.");
      if (target.role === "admin" && users.filter((user) => user.role === "admin").length <= 1) {
        throw new Error("Cannot delete the last admin user.");
      }
      await this.repo.delete({ id });
    });
  }

  async setPassword(id: string, password: string): Promise<void> {
    if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
      throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    }
    const passwordHash = this.hashPassword(password);
    await withLock(USERS_LOCK, async () => {
      const users = await this.readUsers();
      const current = users.find((user) => user.id === id);
      if (!current) throw new Error("User not found.");
      const next: StudioUser = { ...current, passwordHash };
      await this.repo.update({ id }, { data: next });
    });
  }

  /* ------------------------------------------------------------------ *
   * Credentials
   * ------------------------------------------------------------------ */

  async verifyCredentials(username: string, password: string): Promise<StudioUser | null> {
    if (typeof username !== "string" || typeof password !== "string" || password === "") {
      return null;
    }
    const user = await this.getUserByUsername(username);
    if (!user) {
      this.burnHashingTime(password);
      return null;
    }
    return this.verifyPassword(password, user.passwordHash) ? user : null;
  }
}
