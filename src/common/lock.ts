/**
 * In-process mutex. Every task queued under the same key runs after the
 * previous one settled, so a read-modify-write pair can never interleave with
 * another writer inside this process.
 *
 * This only serialises writers within a single warm process (this backend is
 * a long-lived Node server, not serverless, but the same caution still
 * applies to any horizontally-scaled deployment) - cross-instance safety
 * comes from the database's own UNIQUE constraints (see `isUniqueViolation`
 * in `../database/pg-helpers`).
 */
const chains = new Map<string, Promise<void>>();

export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = chains.get(key) ?? Promise.resolve();
  const run = previous.then(fn);
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  chains.set(key, settled);
  void settled.then(() => {
    if (chains.get(key) === settled) chains.delete(key);
  });
  return run;
}
