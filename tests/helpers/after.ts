/** Waits for every task passed to the mocked after() (see tests/setup.ts). */
export async function flushAfter(): Promise<void> {
  const g = globalThis as { __afterTasks?: Promise<unknown>[] };
  while (g.__afterTasks?.length) await Promise.all(g.__afterTasks.splice(0));
}

/** Drops pending after() tasks without waiting, for a test that leaves one hanging on purpose. */
export function discardAfter(): void {
  const g = globalThis as { __afterTasks?: Promise<unknown>[] };
  g.__afterTasks?.splice(0);
}
