/**
 * `/api/admin/projects` - ported from the original Next.js studio's
 * `src/app/api/admin/projects/route.ts` and `.../[projectId]/route.ts`.
 */
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, UseGuards } from "@nestjs/common";
import { NotFoundException } from "@nestjs/common";

import { AuthGuard } from "../auth/auth.guard";
import { headerMap, isRecord, queryParam } from "../common/http";
import { StoreError } from "../common/store-error";
import type { EndpointDef, ProjectDef, ProjectInput } from "../common/types";
import { EndpointsService } from "../endpoints/endpoints.service";
import { ProjectsService, type ProjectWithCounts } from "./projects.service";

interface ProjectDetail {
  project: ProjectDef;
  endpoints: EndpointDef[];
}

@Controller("api/admin/projects")
@UseGuards(AuthGuard)
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly endpoints: EndpointsService,
  ) {}

  /**
   * `?withCounts=1` returns each project with its endpoint counts (one SQL
   * query, see `ProjectsService.listProjectsWithCounts()`) - used by the
   * Next.js frontend's dashboard/projects Server Components. The studio's own
   * client-side `adminApi.listProjects()` never sets this and keeps getting
   * plain `ProjectDef[]`.
   */
  @Get()
  list(@Query("withCounts") withCounts?: string): Promise<ProjectDef[] | ProjectWithCounts[]> {
    return queryParam(withCounts) ? this.projects.listProjectsWithCounts() : this.projects.listProjects();
  }

  @Post()
  @HttpCode(201)
  create(@Body() raw: unknown): Promise<ProjectDef> {
    if (!isRecord(raw)) throw new StoreError("Request body must be a JSON object", 400);

    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    if (!name) throw new StoreError("Project name is required", 400);

    const slug = typeof raw.slug === "string" ? raw.slug.trim() : "";
    const id = typeof raw.id === "string" ? raw.id.trim() : "";

    const input: ProjectInput = {
      name,
      slug: slug || name,
      description: typeof raw.description === "string" ? raw.description : "",
      defaultHeaders: headerMap(raw.defaultHeaders),
      color: typeof raw.color === "string" ? raw.color : "",
      ...(id ? { id } : {}),
    };

    return this.projects.createProject(input);
  }

  @Get(":projectId")
  async detail(@Param("projectId") projectId: string): Promise<ProjectDetail> {
    const project = await this.projects.getProject(projectId);
    if (!project) throw new NotFoundException("Project not found");

    const endpoints = await this.endpoints.listEndpoints(project.id);
    return { project, endpoints };
  }

  @Put(":projectId")
  update(@Param("projectId") projectId: string, @Body() raw: unknown): Promise<ProjectDef> {
    if (!isRecord(raw)) throw new StoreError("Request body must be a JSON object", 400);

    const patch: Partial<ProjectDef> = {};

    if (raw.name !== undefined) {
      const name = typeof raw.name === "string" ? raw.name.trim() : "";
      if (!name) throw new StoreError("Project name is required", 400);
      patch.name = name;
    }
    if (raw.slug !== undefined) {
      const slug = typeof raw.slug === "string" ? raw.slug.trim() : "";
      if (!slug) throw new StoreError("Project slug is required", 400);
      patch.slug = slug;
    }
    if (raw.description !== undefined) {
      patch.description = typeof raw.description === "string" ? raw.description : "";
    }
    if (raw.defaultHeaders !== undefined) {
      patch.defaultHeaders = headerMap(raw.defaultHeaders);
    }
    if (raw.color !== undefined && typeof raw.color === "string" && raw.color.trim()) {
      patch.color = raw.color.trim();
    }

    return this.projects.updateProject(projectId, patch);
  }

  @Delete(":projectId")
  async remove(@Param("projectId") projectId: string): Promise<{ deleted: true }> {
    await this.projects.deleteProject(projectId);
    return { deleted: true };
  }
}
