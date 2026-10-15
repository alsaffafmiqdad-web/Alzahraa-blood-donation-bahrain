/*
 * Isomorphic and pure: turns a caught value into one readable line for alerts and logs.
 * Node's fetch (undici) throws "TypeError: fetch failed" and keeps the real reason (ECONNREFUSED,
 * ENOTFOUND, a timeout code, with address and port) in err.cause, so this walks the cause chain,
 * at most MAX_DEPTH levels. It reads only messages and network fields, never request data, and
 * never throws.
 */

const MAX_DEPTH = 3;
const MAX_FIELD = 200;
const CODE_RE = /\b(E[A-Z]{3,}|UND_ERR_[A-Z_]+)\b/;

function str(v: unknown): string | undefined {
  if (typeof v === "string" && v) return v.slice(0, MAX_FIELD);
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return undefined;
}

function field(o: object, key: string): unknown {
  try {
    return (o as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

/** The error code of a value, if it has one (also found in a string `details`, as Supabase puts it). */
function codeOf(o: object): string | undefined {
  const code = str(field(o, "code"));
  if (code) return code;
  const details = field(o, "details");
  return typeof details === "string" ? CODE_RE.exec(details)?.[1] : undefined;
}

/** "ECONNREFUSED connect 127.0.0.1:54321", or "" when none of the network fields are present. */
function networkSummary(o: object): string {
  const hostPort = [str(field(o, "address")), str(field(o, "port"))].filter(Boolean).join(":");
  return [codeOf(o), str(field(o, "syscall")), hostPort].filter(Boolean).join(" ");
}

function messageOf(v: unknown): string {
  if (typeof v === "string") return v.slice(0, MAX_FIELD);
  if (v === null || v === undefined) return "unknown";
  if (typeof v === "object") return str(field(v, "message")) ?? str(field(v, "name")) ?? "unknown";
  return "unknown";
}

/** The message plus the cause chain, e.g. "fetch failed (cause: ECONNREFUSED connect 127.0.0.1:54321)". */
export function describeError(e: unknown): string {
  try {
    const seen = new Set<unknown>();
    const walk = (v: unknown, depth: number): string => {
      const isObj = typeof v === "object" && v !== null;
      if (isObj) seen.add(v);
      const cause = isObj ? field(v, "cause") : undefined;
      const hasCause = cause !== undefined && cause !== null && !seen.has(cause) && depth < MAX_DEPTH;
      const net = isObj ? networkSummary(v) : "";
      // A cause with network fields reads best as just those fields; the top level keeps its message.
      const head = depth > 0 && net ? net : messageOf(v);
      const tail = depth === 0 && net ? ` [${net}]` : "";
      return `${head}${tail}${hasCause ? ` (cause: ${walk(cause, depth + 1)})` : ""}`;
    };
    return walk(e, 0);
  } catch {
    return "unknown";
  }
}
