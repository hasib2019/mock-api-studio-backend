import { Column, Entity, PrimaryColumn } from "typeorm";

/** Mirrors the `studio_users` table exactly as `scripts/setup-db.mjs` creates it. */
@Entity({ name: "studio_users" })
export class StudioUserEntity {
  @PrimaryColumn({ type: "text" })
  id!: string;

  @Column({ type: "text", unique: true })
  username!: string;

  /** The full `StudioUser` (see `../../common/types`), password hash included. */
  @Column({ type: "jsonb" })
  data!: unknown;
}
