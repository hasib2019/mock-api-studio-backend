/**
 * `/api/admin/import` and `/api/admin/export/:projectId` - ported from the
 * original Next.js studio's `src/app/api/admin/import/route.ts` and
 * `.../export/[projectId]/route.ts`.
 */
import { Body, Controller, Get, NotFoundException, Param, Post, Query, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";

import { AuthGuard } from "../auth/auth.guard";
import { publicOrigin } from "../common/http";
import { StoreError } from "../common/store-error";
import { toOpenApi, toPostman, toStudioJson } from "../common/export";
import { EndpointsService } from "../endpoints/endpoints.service";
import { ProjectsService } from "../projects/projects.service";
import { ImportExportService } from "./import-export.service";
import { RawResponse } from "../common/raw-response";

const FORMATS = ["json", "openapi", "postman"] as const;

@Controller("api/admin")
@UseGuards(AuthGuard)
export class ImportExportController {
  constructor(
    private readonly importExport: ImportExportService,
    private readonly projects: ProjectsService,
    private readonly endpoints: EndpointsService,
  ) {}

  @Post("import")
  importData(@Body() raw: unknown): Promise<{ projects: number; endpoints: number }> {
    return this.importExport.importData(raw);
  }

  /**
   * Downloads one project as a file.
   *
   *   ?format=json     native studio backup - feed it back to POST /api/admin/import
   *   ?format=openapi  OpenAPI 3.1 document
   *   ?format=postman  Postman v2.1 collection
   *
   * A download, not an envelope: the file must be usable as-is by Swagger UI,
   * by Postman, or by the import route - `RawResponse` opts this one route out
   * of the `{ ok: true, data }` wrapping every other admin route gets.
   */
  @Get("export/:projectId")
  async export(
    @Param("projectId") projectId: string,
    @Query("format") format: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RawResponse<unknown>> {
    const project = await this.projects.getProject(projectId);
    if (!project) throw new NotFoundException("Project not found");

    const requested = (format ?? "json").trim().toLowerCase();
    const matched = FORMATS.find((candidate) => candidate === requested);
    if (!matched) {
      throw new StoreError(`Unsupported export format "${requested}". Use json, openapi or postman.`, 400);
    }

    const endpoints = await this.endpoints.listEndpoints(project.id);
    // The browser never talks to this process directly - the Next.js frontend
    // proxies `/api/admin/export/*` here server-to-server (see its
    // `next.config.ts` rewrites and `src/proxy.ts`, which stamps the ORIGINAL
    // request's host/proto onto `x-forwarded-*` before the rewrite happens).
    // Trust those first so the exported document's server URL is the one a
    // caller can actually reach; fall back to this request's own values for
    // local development against the backend directly.
    const origin = publicOrigin(res.req);

    const document =
      matched === "openapi"
        ? toOpenApi(project, endpoints, origin)
        : matched === "postman"
          ? toPostman(project, endpoints, origin)
          : toStudioJson(project, endpoints);

    res.header("content-disposition", `attachment; filename="${project.slug}-${matched}.json"`);
    res.header("cache-control", "no-store");
    return new RawResponse(document);
  }
}
