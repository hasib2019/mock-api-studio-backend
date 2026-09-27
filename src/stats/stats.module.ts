import { Module } from "@nestjs/common";

import { SessionModule } from "../auth/session.module";
import { LogsModule } from "../logs/logs.module";
import { StoreModule } from "../store/store.module";
import { StatsController } from "./stats.controller";

@Module({
  imports: [StoreModule, LogsModule, SessionModule],
  controllers: [StatsController],
})
export class StatsModule {}
