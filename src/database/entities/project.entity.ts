import { Column, Entity, PrimaryColumn } from "typeorm";

/**
 * Mirrors the `projects` table exactly as `scripts/setup-db.mjs` creates it -
 * this entity does not drive schema creation (`synchronize` is always off,
 * see `../database.config`), it only describes an existing table.
 *
 * `data` carries the full `ProjectDef` (see `../../common/types`) as JSONB.
 * It is typed loosely here on purpose: a row can be hand-edited (direct SQL,
 * an older export re-imported, ...), so the service layer still runs it
 * through the same `hydrateProject()`-style normalisation the original
 * Next.js store used, rather than trusting the column's shape.
 */
@Entity({ name: "projects" })
export class ProjectEntity {
  @PrimaryColumn({ type: "text" })
  id!: string;

  @Column({ type: "text", unique: true })
  slug!: string;

  @Column({ type: "jsonb" })
  data!: unknown;
}
