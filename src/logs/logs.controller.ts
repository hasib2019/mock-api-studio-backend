/**
 * `/api/admin/logs` - ported from the original Next.js studio's
 * `src/app/api/admin/logs/route.ts`.
 */
import { Controller, Delete, Get, Query, UseGuards } from "@nestjs/common";

import { AuthGuard } from "../auth/auth.guard";
import { queryParam } from "../common/http";
import type { RequestLog } from "../common/types";
import { LogsService } from "./logs.service";

@Controller("api/admin/logs")
@UseGuards(AuthGuard)
export class LogsController {
  constructor(private readonly logs: LogsService) {}

  @Get()
  list(
    @Query("projectId") projectId?: string,
    @Query("endpointId") endpointId?: string,
    @Query("outcome") outcome?: string,
    @Query("limit") limit?: string,
  ): Promise<RequestLog[]> {
    const rawLimit = queryParam(limit);
    const parsed = rawLimit === undefined ? Number.NaN : Number(rawLimit);
    const parsedLimit = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;

    return this.logs.listLogs({
      projectId: queryParam(projectId),
      endpointId: queryParam(endpointId),
      outcome: queryParam(outcome),
      limit: parsedLimit,
    });
  }

  @Delete()
  async clear(
    @Query("projectId") projectId?: string,
    @Query("endpointId") endpointId?: string,
  ): Promise<{ cleared: number }> {
    const cleared = await this.logs.clearLogs({
      projectId: queryParam(projectId),
      endpointId: queryParam(endpointId),
    });
    return { cleared };
  }
}
