/**
 * Projects - ported from the original Next.js studio's `src/lib/store.ts`.
 * Storage moves from raw `pg` queries to a TypeORM repository; every other
 * rule (slug uniqueness, id validation, hydration of hand-editable rows) is
 * unchanged.
 */
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

import { ProjectEntity } from "../database/entities/project.entity";
import { isUniqueViolation } from "../database/pg-helpers";
import { withLock } from "../common/lock";
import { headerMap, isRecord } from "../common/http";
import { newId, slugify } from "../common/ids";
import { PROJECT_COLORS, newProject } from "../common/defaults";
import { requireText, str, stripUndefined, validId } from "../common/store-helpers";
import { StoreError } from "../common/store-error";
import type { ProjectDef, ProjectInput } from "../common/types";

const PROJECTS_LOCK = "store:projects";

export interface ProjectWithCounts extends ProjectDef {
  endpointCount: number;
  enabledCount: number;
}

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
  ) {}

  /* ------------------------------------------------------------------ *
   * Hydration - rows are hand editable (import, direct SQL), so treat them as
   * untrusted the same way the original file-backed store treated JSON files.
   * ------------------------------------------------------------------ */

  private hydrateProject(raw: unknown): ProjectDef | null {
    if (!isRecord(raw)) return null;
    const id = str(raw.id).trim();
    if (!id) return null;
    const now = new Date().toISOString();
    return {
      id,
      name: str(raw.name, id),
      slug: slugify(str(raw.slug, id)),
      description: str(raw.description),
      defaultHeaders: headerMap(raw.defaultHeaders),
      color: str(raw.color).trim() || PROJECT_COLORS[0],
      createdAt: str(raw.createdAt, now),
      updatedAt: str(raw.updatedAt, now),
    };
  }

  private async readAllProjects(): Promise<ProjectDef[]> {
    const rows = await this.projects.find();
    return rows
      .map((row) => this.hydrateProject(row.data))
      .filter((p): p is ProjectDef => p !== null);
  }

  /* ------------------------------------------------------------------ *
   * Reads
   * ------------------------------------------------------------------ */

  async listProjects(): Promise<ProjectDef[]> {
    const projects = await this.readAllProjects();
    return projects.sort((a, b) => a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug));
  }

  /**
   * Projects, each with how many endpoints it holds - one query (a `LEFT
   * JOIN` + `GROUP BY`) instead of pulling every endpoint's full definition
   * across the wire just to call `.length` on the result. `enabled` reads the
   * same as `hydrateEndpoint()` does: anything not explicitly `false` counts.
   * Exposed via `GET /api/admin/projects?withCounts=1` for the Next.js
   * frontend's dashboard/projects Server Components.
   */
  async listProjectsWithCounts(): Promise<ProjectWithCounts[]> {
    const rows = await this.projects.manager.query<
      Array<{ data: unknown; endpoint_count: string; enabled_count: string }>
    >(
      `SELECT p.data,
              COALESCE(c.total, 0)::int AS endpoint_count,
              COALESCE(c.enabled, 0)::int AS enabled_count
         FROM projects p
         LEFT JOIN (
           SELECT project_id,
                  count(*)::int AS total,
                  count(*) FILTER (
                    WHERE data->'enabled' IS DISTINCT FROM 'false'::jsonb
                  )::int AS enabled
             FROM endpoints
            GROUP BY project_id
         ) c ON c.project_id = p.id`,
    );

    const out: ProjectWithCounts[] = [];
    for (const row of rows) {
      const project = this.hydrateProject(row.data);
      if (!project) continue;
      out.push({
        ...project,
        endpointCount: Number(row.endpoint_count),
        enabledCount: Number(row.enabled_count),
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug));
  }

  async getProject(id: string): Promise<ProjectDef | null> {
    const recordId = validId(str(id).trim());
    if (!recordId) return null;
    const row = await this.projects.findOneBy({ id: recordId });
    return row ? this.hydrateProject(row.data) : null;
  }

  async getProjectBySlug(slug: string): Promise<ProjectDef | null> {
    const wanted = slugify(str(slug));
    if (!wanted) return null;
    const row = await this.projects.findOneBy({ slug: wanted });
    return row ? this.hydrateProject(row.data) : null;
  }

  /* ------------------------------------------------------------------ *
   * Mutations
   * ------------------------------------------------------------------ */

  async createProject(input: ProjectInput): Promise<ProjectDef> {
    return withLock(PROJECTS_LOCK, async () => {
      const name = requireText(input.name, "Project name");
      const slug = slugify(str(input.slug).trim() || name);
      if (!slug) throw new StoreError("Project slug is required", 400);

      const existing = await this.readAllProjects();
      if (existing.some((project) => project.slug === slug)) {
        throw new StoreError(`A project with the slug "${slug}" already exists`, 409);
      }

      const id = str(input.id).trim() || newId("pr");
      const recordId = validId(id);
      if (!recordId) throw new StoreError("Invalid project id", 400);
      if (existing.some((project) => project.id === recordId)) {
        throw new StoreError(`Project "${recordId}" already exists`, 409);
      }

      const now = new Date().toISOString();
      const project = newProject({
        ...input,
        id: recordId,
        name,
        slug,
        description: str(input.description),
        defaultHeaders: headerMap(input.defaultHeaders),
        color: str(input.color).trim() || PROJECT_COLORS[existing.length % PROJECT_COLORS.length],
        createdAt: now,
        updatedAt: now,
      });

      try {
        await this.projects.insert({ id: project.id, slug: project.slug, data: project });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new StoreError(`A project with the slug "${slug}" already exists`, 409);
        }
        throw error;
      }
      return project;
    });
  }

  async updateProject(id: string, patch: Partial<ProjectDef>): Promise<ProjectDef> {
    return withLock(PROJECTS_LOCK, async () => {
      const recordId = validId(str(id).trim());
      const current = recordId ? await this.getProject(recordId) : null;
      if (!recordId || !current) throw new StoreError("Project not found", 404);

      const clean = stripUndefined(patch);
      const name = "name" in clean ? requireText(clean.name, "Project name") : current.name;

      let slug = current.slug;
      if ("slug" in clean) {
        slug = slugify(str(clean.slug));
        if (!slug) throw new StoreError("Project slug is required", 400);
      }
      if (slug !== current.slug) {
        const existing = await this.readAllProjects();
        if (existing.some((project) => project.id !== current.id && project.slug === slug)) {
          throw new StoreError(`A project with the slug "${slug}" already exists`, 409);
        }
      }

      const next: ProjectDef = {
        ...current,
        ...clean,
        id: current.id,
        name,
        slug,
        defaultHeaders:
          "defaultHeaders" in clean ? headerMap(clean.defaultHeaders) : current.defaultHeaders,
        createdAt: current.createdAt,
        updatedAt: new Date().toISOString(),
      };

      try {
        await this.projects.update({ id: next.id }, { slug: next.slug, data: next });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new StoreError(`A project with the slug "${slug}" already exists`, 409);
        }
        throw error;
      }
      return next;
    });
  }

  /** Deletes the project and every endpoint that belongs to it (FK cascade). */
  async deleteProject(id: string): Promise<void> {
    await withLock(PROJECTS_LOCK, async () => {
      const recordId = validId(str(id).trim());
      const current = recordId ? await this.getProject(recordId) : null;
      if (!recordId || !current) throw new StoreError("Project not found", 404);
      await this.projects.delete({ id: recordId });
    });
  }
}

