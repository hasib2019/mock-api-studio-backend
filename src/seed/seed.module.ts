import { Module } from "@nestjs/common";

import { SessionModule } from "../auth/session.module";
import { StoreModule } from "../store/store.module";
import { SeedController } from "./seed.controller";
import { SeedService } from "./seed.service";

@Module({
  imports: [StoreModule, SessionModule],
  controllers: [SeedController],
  providers: [SeedService],
})
export class SeedModule {}
