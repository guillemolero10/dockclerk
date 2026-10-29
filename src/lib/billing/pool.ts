// Runs async work over a list with a cap on how many run at once, and gives the results back in the order of the list.
// The cap keeps a page from opening a connection per customer at the same time (the database pool is small on Vercel),
// and the order means the outcome does not depend on which task finished first.

/** At most `limit` tasks in flight. If one fails, no new task starts and the first error is thrown. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, task: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  const width = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const i = next++;
      try {
        results[i] = await task(items[i], i);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: width }, worker));
  return results;
}
