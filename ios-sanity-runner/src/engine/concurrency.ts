/**
 * Runs an async mapper over items with a bounded number in flight. Used to fan
 * suites out across a device pool without overwhelming Appium/the host. Results
 * preserve input order; a rejected item is captured as a rejection in its slot
 * (the pool wrapper turns these into failed SuiteResults rather than aborting
 * the whole run).
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const bound = Math.max(1, Math.min(limit, items.length || 1));
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = { status: 'fulfilled', value: await mapper(items[i] as T, i) };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
    }
  }

  await Promise.all(Array.from({ length: bound }, () => worker()));
  return results;
}
