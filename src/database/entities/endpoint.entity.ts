import { Column, Entity, Index, PrimaryColumn, Unique } from "typeorm";

/**
 * Mirrors the `endpoints` table exactly as `scripts/setup-db.mjs` creates it.
 * See `./project.entity.ts` for why `data` is typed loosely and why this file
 * does not declare a `@ManyToOne` relation to `ProjectEntity`: the foreign key
 * (with `ON DELETE CASCADE`) already exists physically in the database, and
 * `synchronize` is always off, so a relation decorator here would only add
 * eager-load risk without ever generating schema. Referential checks (does
 * the project exist?) are done explicitly in `EndpointsService`, exactly as
 * the original `store.ts` did.
 */
@Entity({ name: "endpoints" })
@Unique(["projectId", "method", "path"])
export class EndpointEntity {
  @PrimaryColumn({ type: "text" })
  id!: string;

  @Column({ type: "text", name: "project_id" })
  @Index("endpoints_project_id_idx")
  projectId!: string;

  @Column({ type: "text" })
  method!: string;

  @Column({ type: "text" })
  path!: string;

  @Column({ type: "jsonb" })
  data!: unknown;
}
