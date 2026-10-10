import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) walk(rel, out);
    else if (/\.(tsx?|css)$/.test(e.name)) out.push(rel);
  }
  return out;
}

describe("status names have one source", () => {
  it("no file under app/ or components/ keeps its own status label", () => {
    const banned = ["Registration Station", "Doctor Station", "Donation Reception", "STATUS_LABELS"];
    const hits: string[] = [];
    for (const f of [...walk("app"), ...walk("components")]) {
      const src = fs.readFileSync(path.join(root, f), "utf8");
      for (const word of banned) if (src.includes(word)) hits.push(`${f}: ${word}`);
    }
    expect(hits).toEqual([]);
  });
  it("admin pages take labels from getStatusLabels", () => {
    for (const f of [
      "app/admin/page.tsx",
      "app/admin/donors/[id]/page.tsx",
      "app/admin/slots/page.tsx",
      "app/admin/event/page.tsx",
      "app/admin/export/route.ts",
      "app/admin/actions.ts",
    ]) {
      expect(fs.readFileSync(path.join(root, f), "utf8"), f).toContain("getStatusLabels(supabase)");
    }
  });
});
