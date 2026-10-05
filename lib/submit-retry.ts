/* Isomorphic and pure: how the signup form reacts to a submit response. */

export const MAX_AUTO_RETRIES = 2;
export const RETRY_DELAYS_MS = [1500, 4000] as const;
export const SUBMIT_TIMEOUT_MS = 40_000;
export const TOKEN_WAIT_MS = 20_000;

export type SubmitOutcome =
  | { kind: "success" }
  | { kind: "retryable"; reason: "network" | "server" | "bad_response"; status?: number }
  | { kind: "fatal"; error: string; status: number };

export function classifySubmit(
  r: { networkError: true } | { networkError?: false; status: number; json: unknown },
): SubmitOutcome {
  if (r.networkError) return { kind: "retryable", reason: "network" };
  const { status, json } = r;
  if (status >= 200 && status < 300) {
    const ok = typeof json === "object" && json !== null && (json as { ok?: unknown }).ok === true;
    return ok ? { kind: "success" } : { kind: "retryable", reason: "bad_response", status };
  }
  if (status === 408) return { kind: "retryable", reason: "network", status };
  if (status >= 500) return { kind: "retryable", reason: "server", status };
  const err = typeof json === "object" && json !== null ? (json as { error?: unknown }).error : undefined;
  return { kind: "fatal", error: typeof err === "string" ? err : "server", status };
}

/** RETRY_DELAYS_MS[attempt] +/- 20%. */
export function retryDelay(attempt: number, random: () => number = Math.random): number {
  const base = RETRY_DELAYS_MS[Math.min(Math.max(attempt, 0), RETRY_DELAYS_MS.length - 1)]!;
  return Math.round(base * (0.8 + random() * 0.4));
}
