import { Column, Entity, Index, PrimaryColumn } from "typeorm";

/**
 * Mirrors the `request_logs` table exactly as `scripts/setup-db.mjs` creates
 * it. `outcome`, `project_id`, `ts` are pulled out as real columns (indexed)
 * so `LogsService` can filter and aggregate in SQL instead of pulling every
 * row's full JSONB payload across the wire - see `LogsService.stats()`.
 */
@Entity({ name: "request_logs" })
export class RequestLogEntity {
  @PrimaryColumn({ type: "text" })
  id!: string;

  @Column({ type: "timestamptz" })
  @Index("request_logs_ts_idx")
  ts!: Date;

  @Column({ type: "text", name: "project_id", nullable: true })
  @Index("request_logs_project_id_idx")
  projectId!: string | null;

  @Column({ type: "text", name: "endpoint_id", nullable: true })
  @Index("request_logs_endpoint_id_idx")
  endpointId!: string | null;

  @Column({ type: "text", nullable: true })
  outcome!: string | null;

  /** The full `RequestLog` (see `../../common/types`). */
  @Column({ type: "jsonb" })
  data!: unknown;
}
