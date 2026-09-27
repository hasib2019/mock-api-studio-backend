import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";

import { buildTypeOrmOptions } from "./database.config";

/**
 * Wires the single TypeORM connection for the whole app. Feature modules
 * import `TypeOrmModule.forFeature([SomeEntity])` themselves to get
 * repositories injected - this module only owns the connection itself.
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => buildTypeOrmOptions(config),
    }),
  ],
})
export class DatabaseModule {}
