/**
 * Minimal Supabase stand-in for `from().select().order()...range(from, to)`, like PostgREST with
 * max_rows = `maxRows` (default 1000): it never returns more than maxRows rows per request, whatever
 * range was asked for, so tests catch code that silently stops at the first page.
 */
export function pagedSupabase(rows: unknown[], opts: { maxRows?: number; error?: { message: string } } = {}) {
  const maxRows = opts.maxRows ?? 1000;
  const requests: { from: number; to: number }[] = [];
  const builder = () => {
    const c: Record<string, unknown> = {};
    c.select = () => c;
    c.order = () => c;
    c.not = () => c;
    c.range = async (from: number, to: number) => {
      requests.push({ from, to });
      if (opts.error) return { data: null, error: opts.error };
      return { data: rows.slice(from, Math.min(to + 1, from + maxRows)), error: null };
    };
    return c;
  };
  return { supabase: { from: () => builder() }, requests };
}
