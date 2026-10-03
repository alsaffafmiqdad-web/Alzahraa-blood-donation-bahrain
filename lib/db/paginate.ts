import "server-only";

/** PostgREST caps every response at `max_rows` (1000 by default), whatever .limit() says. */
export const PAGE_SIZE = 1000;

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/**
 * Reads every row by walking .range() pages. `build` must apply a stable total order
 * (for example created_at then id) so pages never overlap or skip.
 */
export async function fetchAllRows<T>(
  build: (from: number, to: number) => Page<T>,
  pageSize = PAGE_SIZE,
): Promise<{ data: T[]; error: { message: string } | null }> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) return { data: out, error };
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) return { data: out, error: null };
  }
}
