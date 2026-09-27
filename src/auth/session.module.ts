import { Module } from "@nestjs/common";

import { AuthGuard } from "./auth.guard";
import { SessionService } from "./session.service";

/**
 * Just `SessionService` + `AuthGuard`, with no other module dependencies -
 * split out from `AuthModule` so every module whose controller needs
 * `@UseGuards(AuthGuard)` (nearly all of them) can import this directly
 * without pulling in `AuthModule`'s own `UsersModule` dependency. `AuthModule`
 * itself also imports this rather than re-declaring these two providers.
 *
 * Importing `AuthModule` instead of this for just the guard would risk a
 * circular module dependency the moment any module `AuthModule` depends on
 * (directly or transitively) also needs `AuthGuard` - `UsersModule` is
 * exactly that case: `AuthModule` imports it for login, and its own
 * `UsersController` needs the guard too.
 */
@Module({
  providers: [SessionService, AuthGuard],
  exports: [SessionService, AuthGuard],
})
export class SessionModule {}
