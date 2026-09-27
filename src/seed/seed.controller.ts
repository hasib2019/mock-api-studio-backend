/**
 * `/api/admin/seed` - ported from the original Next.js studio's
 * `src/app/api/admin/seed/route.ts`.
 */
import { Controller, Post, UseGuards } from "@nestjs/common";

import { AuthGuard } from "../auth/auth.guard";
import { SeedService } from "./seed.service";

@Controller("api/admin/seed")
@UseGuards(AuthGuard)
export class SeedController {
  constructor(private readonly seed: SeedService) {}

  /** Installs the demo banking project. Idempotent - calling it twice is a no-op. */
  @Post()
  install(): Promise<{ projects: number; endpoints: number }> {
    return this.seed.seedDemoData();
  }
}
