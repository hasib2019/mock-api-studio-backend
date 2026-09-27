/**
 * Installs the demo banking project - ported from the original Next.js
 * studio's `seedDemoData()` in `src/lib/seed.ts`. Idempotent: a project whose
 * slug is already registered is skipped, so calling this twice never
 * duplicates anything.
 */
import { Injectable } from "@nestjs/common";

import { newProject } from "../common/defaults";
import { EndpointsService } from "../endpoints/endpoints.service";
import { ProjectsService } from "../projects/projects.service";
import { DEMO_PROJECT, DEMO_SLUG, ENDPOINT_BUILDERS } from "./seed-data";

@Injectable()
export class SeedService {
  constructor(
    private readonly projects: ProjectsService,
    private readonly endpoints: EndpointsService,
  ) {}

  async seedDemoData(): Promise<{ projects: number; endpoints: number }> {
    const existing = await this.projects.getProjectBySlug(DEMO_SLUG);
    if (existing) return { projects: 0, endpoints: 0 };

    const project = await this.projects.createProject(newProject(DEMO_PROJECT));

    let endpoints = 0;
    for (const build of ENDPOINT_BUILDERS) {
      await this.endpoints.createEndpoint(build(project.id));
      endpoints += 1;
    }

    return { projects: 1, endpoints };
  }
}
