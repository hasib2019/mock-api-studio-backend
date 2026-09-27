import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { SessionModule } from "../auth/session.module";
import { EndpointEntity } from "../database/entities/endpoint.entity";
import { ProjectEntity } from "../database/entities/project.entity";
import { EndpointsController } from "../endpoints/endpoints.controller";
import { EndpointsService } from "../endpoints/endpoints.service";
import { ProjectsController } from "../projects/projects.controller";
import { ProjectsService } from "../projects/projects.service";

/**
 * Projects and endpoints in one module - ported from the original Next.js
 * studio's `src/lib/store.ts`, which kept both in one file because
 * `EndpointsService` depends on `ProjectsService` (does the project exist?)
 * and `ProjectsController`'s project-detail route depends on
 * `EndpointsService` (list this project's endpoints). Splitting them into two
 * modules that import each other would be a circular module dependency for no
 * benefit; Nest's DI does not care about file layout within one module.
 */
@Module({
  imports: [TypeOrmModule.forFeature([ProjectEntity, EndpointEntity]), SessionModule],
  controllers: [ProjectsController, EndpointsController],
  providers: [ProjectsService, EndpointsService],
  exports: [ProjectsService, EndpointsService],
})
export class StoreModule {}
