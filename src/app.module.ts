import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";

import { AllExceptionsFilter } from "./common/all-exceptions.filter";
import { ApiEnvelopeInterceptor } from "./common/api-envelope.interceptor";
import { DatabaseModule } from "./database/database.module";
import { AuthModule } from "./auth/auth.module";
import { StoreModule } from "./store/store.module";
import { LogsModule } from "./logs/logs.module";
import { StatsModule } from "./stats/stats.module";
import { SeedModule } from "./seed/seed.module";
import { ImportExportModule } from "./import-export/import-export.module";
import { InferSchemaModule } from "./infer-schema/infer-schema.module";
import { MockModule } from "./mock/mock.module";

@Module({
  imports: [
    // `.env.local` first (git-ignored, real secrets) so it wins over a
    // committed `.env` - the same precedence and filename `scripts/setup-db.mjs`
    // and the Next.js frontend already use.
    ConfigModule.forRoot({ isGlobal: true, envFilePath: [".env.local", ".env"] }),
    DatabaseModule,
    AuthModule,
    StoreModule,
    LogsModule,
    StatsModule,
    SeedModule,
    ImportExportModule,
    InferSchemaModule,
    MockModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: ApiEnvelopeInterceptor },
  ],
})
export class AppModule {}
