import { Module } from "@nestjs/common";

import { SessionModule } from "../auth/session.module";
import { InferSchemaController } from "./infer-schema.controller";

@Module({
  imports: [SessionModule],
  controllers: [InferSchemaController],
})
export class InferSchemaModule {}
