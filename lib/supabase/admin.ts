import "server-only";
import { createClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";

/** fetch whose requests all abort at one shared deadline, on top of any signal the caller passed. */
export function fetchWithDeadline(deadline: AbortSignal): typeof fetch {
  return (input, init) => {
    const signal = init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
    return fetch(input, { ...init, signal });
  };
}

/**
 * Service-role client. Bypasses RLS: use only in server code for the public signup path, email, cron.
 * `deadlineMs` caps the total time of every request made through this client.
 */
export function createSupabaseAdminClient(opts: { deadlineMs?: number } = {}) {
  const env = serverEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(opts.deadlineMs ? { global: { fetch: fetchWithDeadline(AbortSignal.timeout(opts.deadlineMs)) } } : {}),
  });
}
