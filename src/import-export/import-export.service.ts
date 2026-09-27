/**
 * `POST /api/admin/import` orchestration - ported from the original Next.js
 * studio's `src/app/api/admin/import/route.ts`. The pure rebuilding logic
 * lives in `./import-payload.ts`; this service only does the parts that touch
 * the database.
 */
import { Injectable } from "@nestjs/common";

import { normalizePath, slugify } from "../common/ids";
import { StoreError } from "../common/store-error";
import { EndpointsService } from "../endpoints/endpoints.service";
import { ProjectsService } from "../projects/projects.service";
import { collectDocs, headerMap, toEndpoint, unwrap } from "./import-payload";

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

@Injectable()
export class ImportExportService {
  constructor(
    private readonly projects: ProjectsService,
    private readonly endpoints: EndpointsService,
  ) {}

  private async freeSlug(preferred: string): Promise<string> {
    const base = slugify(preferred).slice(0, 50) || "imported-project";
    let candidate = base;
    for (let suffix = 2; suffix < 500; suffix++) {
      if (!(await this.projects.getProjectBySlug(candidate))) return candidate;
      candidate = `${base}-${suffix}`;
    }
    return `${base}-${Date.now().toString(36)}`;
  }

  async importData(payload: unknown): Promise<{ projects: number; endpoints: number }> {
    const docs = collectDocs(unwrap(payload));
    if (docs.length === 0) {
      throw new StoreError(
        "Nothing to import. Expected { data: { project, endpoints } } - the shape produced by the JSON export.",
        400,
      );
    }

    let projects = 0;
    let endpointsCreated = 0;

    for (const doc of docs) {
      const name = str(doc.project.name).trim() || "Imported project";
      const project = await this.projects.createProject({
        name,
        slug: await this.freeSlug(str(doc.project.slug).trim() || name),
        description: str(doc.project.description),
        defaultHeaders: headerMap(doc.project.defaultHeaders),
        color: str(doc.project.color),
      });
      projects += 1;

      const taken = new Set<string>();
      for (const raw of doc.endpoints) {
        const endpoint = toEndpoint(project.id, raw);

        let path = endpoint.path;
        for (let suffix = 2; taken.has(`${endpoint.method} ${path}`); suffix++) {
          path = normalizePath(`${endpoint.path}-${suffix}`);
        }
        taken.add(`${endpoint.method} ${path}`);

        await this.endpoints.createEndpoint({ ...endpoint, path });
        endpointsCreated += 1;
      }
    }

    return { projects, endpoints: endpointsCreated };
  }
}
