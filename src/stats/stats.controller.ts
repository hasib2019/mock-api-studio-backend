/**
 * `/api/admin/stats` - ported from the original Next.js studio's
 * `src/app/api/admin/stats/route.ts`.
 */
import { Controller, Get, UseGuards } from "@nestjs/common";

import { AuthGuard } from "../auth/auth.guard";
import { EndpointsService } from "../endpoints/endpoints.service";
import type { LogStats } from "../logs/logs.service";
import { LogsService } from "../logs/logs.service";
import { ProjectsService } from "../projects/projects.service";

export interface StudioStats {
  projects: number;
  endpoints: number;
  enabledEndpoints: number;
  logs: LogStats;
}

@Controller("api/admin/stats")
@UseGuards(AuthGuard)
export class StatsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly endpoints: EndpointsService,
    private readonly logs: LogsService,
  ) {}

  @Get()
  async get(): Promise<StudioStats> {
    const [projects, endpoints, logs] = await Promise.all([
      this.projects.listProjects(),
      this.endpoints.listEndpoints(),
      this.logs.stats(),
    ]);

    return {
      projects: projects.length,
      endpoints: endpoints.length,
      enabledEndpoints: endpoints.filter((endpoint) => endpoint.enabled).length,
      logs,
    };
  }
}
