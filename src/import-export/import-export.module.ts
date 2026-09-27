import { Module } from "@nestjs/common";

import { SessionModule } from "../auth/session.module";
import { StoreModule } from "../store/store.module";
import { ImportExportController } from "./import-export.controller";
import { ImportExportService } from "./import-export.service";

@Module({
  imports: [StoreModule, SessionModule],
  controllers: [ImportExportController],
  providers: [ImportExportService],
})
export class ImportExportModule {}
