import "server-only";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveStatusLabels, type StatusLabels } from "@/lib/status-labels";

async function load(supabase: SupabaseClient): Promise<StatusLabels> {
  try {
    const { data, error } = await supabase.from("status_labels").select("status, label");
    if (error) {
      console.error(`status labels load failed: ${error.message}`);
      return resolveStatusLabels(null);
    }
    return resolveStatusLabels(data as { status: string; label: string }[] | null);
  } catch (e) {
    console.error(`status labels load failed: ${e instanceof Error ? e.message : "unknown"}`);
    return resolveStatusLabels(null);
  }
}

/** The admin-managed status names, from the caller's (admin session) client. Cached per request. Never throws. */
export const getStatusLabels: (supabase: SupabaseClient) => Promise<StatusLabels> = cache(load);
