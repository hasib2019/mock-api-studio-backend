/**
 * `/api/admin/users` - ported from the original Next.js studio's
 * `src/app/api/admin/users/route.ts` and `.../[userId]/route.ts`.
 */
import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";

import { AuthGuard } from "../auth/auth.guard";
import { CurrentSession } from "../auth/current-session.decorator";
import { isRecord } from "../common/http";
import { StoreError } from "../common/store-error";
import type { SessionPayload, StudioUser, UserRole } from "../common/types";
import { UsersService } from "./users.service";

type PublicUser = Omit<StudioUser, "passwordHash">;

/** The password digest never leaves the server. */
function publicUser(user: StudioUser): PublicUser {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    createdAt: user.createdAt,
  };
}

@Controller("api/admin/users")
@UseGuards(AuthGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  async list(): Promise<PublicUser[]> {
    await this.users.ensureSeedUser();
    const list = await this.users.listUsers();
    return list.map(publicUser);
  }

  @Post()
  @HttpCode(201)
  async create(@CurrentSession() session: SessionPayload, @Body() raw: unknown): Promise<PublicUser> {
    if (session.role !== "admin") throw new ForbiddenException("Only an admin can create users");
    if (!isRecord(raw)) throw new StoreError("Request body must be a JSON object", 400);

    const username = typeof raw.username === "string" ? raw.username.trim().toLowerCase() : "";
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    const password = typeof raw.password === "string" ? raw.password : "";
    const role: UserRole = raw.role === "admin" ? "admin" : "member";

    if (!username) throw new StoreError("Username is required", 400);
    if (!password) throw new StoreError("Password is required", 400);
    if (raw.role !== undefined && raw.role !== "admin" && raw.role !== "member") {
      throw new StoreError('Role must be "admin" or "member"', 400);
    }
    if (await this.users.getUserByUsername(username)) {
      throw new StoreError(`Username "${username}" is already taken.`, 409);
    }

    let created: StudioUser;
    try {
      created = await this.users.createUser({ username, name: name || username, password, role });
    } catch (e) {
      // users.service.ts rejects weak passwords and malformed usernames with plain Errors.
      throw new StoreError(e instanceof Error ? e.message : "Could not create the user", 400);
    }

    return publicUser(created);
  }

  @Delete(":userId")
  async remove(
    @CurrentSession() session: SessionPayload,
    @Param("userId") userId: string,
  ): Promise<{ deleted: true }> {
    if (session.role !== "admin") throw new ForbiddenException("Only an admin can delete users");

    const users = await this.users.listUsers();
    const target = users.find((user) => user.id === userId);
    if (!target) throw new NotFoundException("User not found");

    const admins = users.filter((user) => user.role === "admin").length;
    if (target.role === "admin" && admins <= 1) {
      throw new ConflictException("Cannot delete the last admin user.");
    }

    await this.users.deleteUser(target.id);
    return { deleted: true };
  }
}
