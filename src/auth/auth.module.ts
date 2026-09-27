import { Module } from "@nestjs/common";

import { UsersModule } from "../users/users.module";
import { AuthController } from "./auth.controller";
import { SessionModule } from "./session.module";

@Module({
  imports: [SessionModule, UsersModule],
  controllers: [AuthController],
})
export class AuthModule {}
