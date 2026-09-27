import { Module } from "@nestjs/common";

import { LogsModule } from "../logs/logs.module";
import { StoreModule } from "../store/store.module";
import { MatcherService } from "./matcher.service";
import { MockController } from "./mock.controller";

@Module({
  imports: [StoreModule, LogsModule],
  controllers: [MockController],
  providers: [MatcherService],
})
export class MockModule {}
