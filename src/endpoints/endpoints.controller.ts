/**
 * `/api/admin/endpoints` - ported from the original Next.js studio's
 * `src/app/api/admin/endpoints/route.ts`, `.../[endpointId]/route.ts` and
 * `.../[endpointId]/duplicate/route.ts`.
 */
import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Post, Put, Query, UseGuards } from "@nestjs/common";

import { AuthGuard } from "../auth/auth.guard";
import { queryParam } from "../common/http";
import type { EndpointDef } from "../common/types";
import { EndpointsService } from "./endpoints.service";
import { validateEndpointInput, validateEndpointPatch } from "./endpoint-payload.validator";

@Controller("api/admin/endpoints")
@UseGuards(AuthGuard)
export class EndpointsController {
  constructor(private readonly endpoints: EndpointsService) {}

  @Get()
  list(@Query("projectId") projectId?: string): Promise<EndpointDef[]> {
    return this.endpoints.listEndpoints(queryParam(projectId));
  }

  @Post()
  @HttpCode(201)
  create(@Body() raw: unknown): Promise<EndpointDef> {
    return this.endpoints.createEndpoint(validateEndpointInput(raw));
  }

  @Get(":endpointId")
  async detail(@Param("endpointId") endpointId: string): Promise<EndpointDef> {
    const endpoint = await this.endpoints.getEndpoint(endpointId);
    if (!endpoint) throw new NotFoundException("Endpoint not found");
    return endpoint;
  }

  @Put(":endpointId")
  update(@Param("endpointId") endpointId: string, @Body() raw: unknown): Promise<EndpointDef> {
    return this.endpoints.updateEndpoint(endpointId, validateEndpointPatch(raw));
  }

  @Delete(":endpointId")
  async remove(@Param("endpointId") endpointId: string): Promise<{ deleted: true }> {
    await this.endpoints.deleteEndpoint(endpointId);
    return { deleted: true };
  }

  @Post(":endpointId/duplicate")
  @HttpCode(201)
  duplicate(@Param("endpointId") endpointId: string): Promise<EndpointDef> {
    return this.endpoints.duplicateEndpoint(endpointId);
  }
}
