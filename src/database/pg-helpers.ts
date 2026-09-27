/**
 * Postgres error code for a violated UNIQUE/PRIMARY KEY constraint.
 *
 * TypeORM wraps the raw `pg` error in a `QueryFailedError` whose original
 * error (with `.code`) sits on `.driverError` - so both the raw shape (used
 * when a query runs through `dataSource.query()`) and the wrapped shape (used
 * by `Repository.insert()`/`.save()`) are checked here.
 */
export function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const record = error as { code?: unknown; driverError?: { code?: unknown } };
  return record.code === "23505" || record.driverError?.code === "23505";
}
