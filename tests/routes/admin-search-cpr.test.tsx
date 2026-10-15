import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ supabase: null as unknown }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/link", () => ({ default: () => null }));
vi.mock("@/lib/auth", () => ({ requireAdmin: async () => ({ supabase: h.supabase, userId: "u", displayName: "A" }) }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/email/dispatch", () => ({ sendDonorEmail: vi.fn() }));

const ID0 = "00000000-0000-4000-8000-000000000000";
const ID1 = "00000000-0000-4000-8000-000000000001";
const UNKNOWN = "11111111-1111-4111-8111-111111111111";
const donors = ["990101123", "880201123"].map((cpr, i) => ({
  id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
  full_name: `Donor ${i}`, cpr, phone: null, email: null, blood_type: "O+",
  slot_id: null, source: "self_signup", status: "registered", queue_number: null, flagged: false,
  flag_reasons: [], email_sent: false, created_at: new Date(1.7e12 + i * 1000).toISOString(), dob: null, notes: null,
}));

function fake() {
  return {
    from: () => {
      const c: Record<string, unknown> = {};
      let eqCpr: unknown;
      for (const op of ["select", "order"]) c[op] = () => c;
      c.eq = (col: string, val: unknown) => {
        if (col === "cpr") eqCpr = val;
        return c;
      };
      c.maybeSingle = async () => ({ data: donors.find((d) => d.cpr === eqCpr) ?? null, error: null });
      c.range = async (from: number) => ({ data: donors.slice(from, from + 1000), error: null });
      c.single = async () => ({ data: { name_ar: "a", name_en: "e", location_ar: "l", location_en: "l", event_date: "2026-10-16" }, error: null });
      c.then = (r: (v: unknown) => unknown) => r({ data: [], error: null });
      return c;
    },
  };
}
const flat = (node: unknown, props: Record<string, unknown>[] = [], texts: string[] = []) => {
  if (node == null || typeof node === "boolean") return { props, texts };
  if (typeof node === "string" || typeof node === "number") { texts.push(String(node)); return { props, texts }; }
  if (Array.isArray(node)) { node.forEach((n) => flat(n, props, texts)); return { props, texts }; }
  const el = node as { props?: Record<string, unknown> };
  if (el.props) { props.push(el.props); for (const v of Object.values(el.props)) if (typeof v === "object" || typeof v === "string") flat(v, props, texts); }
  return { props, texts };
};

async function dashboard(sp: Record<string, string>) {
  const { default: Page } = await import("@/app/admin/page");
  const { props, texts } = flat(await Page({ searchParams: Promise.resolve(sp) }));
  const rows = props.find((p) => Array.isArray(p.rows))?.rows as { cpr: string }[];
  return { props, text: texts.join(" "), rows };
}
async function searchTo(q: string): Promise<string> {
  const { searchDonors } = await import("@/app/admin/actions");
  const f = new FormData();
  f.set("q", q);
  try {
    await searchDonors(f);
  } catch (e) {
    return (e as Error).message.replace("NEXT_REDIRECT:", "");
  }
  throw new Error("no redirect");
}

beforeEach(() => {
  h.supabase = fake();
});

describe("admin full CPR search by database lookup", () => {
  it("picks the right donor of two that share the last 4 digits", async () => {
    expect(await searchTo("880201123")).toBe(`/admin?donor=${ID1}`);
  });
  it("an unknown CPR goes to donor=none", async () => {
    expect(await searchTo("770303789")).toBe("/admin?donor=none");
  });
  it("the dashboard shows the one donor and fills the search box", async () => {
    const { props, rows } = await dashboard({ donor: ID0 });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.cpr).toBe("990101123");
    expect(props.some((p) => p.name === "q" && p.defaultValue === "990101123")).toBe(true);
    const hrefs = props.map((p) => p.href).filter((x): x is string => typeof x === "string");
    expect(hrefs.some((x) => x.startsWith(`/admin/print?donor=${ID0}`))).toBe(true);
    expect(hrefs.some((x) => x.includes("990101123"))).toBe(false);
  });
  it("another filter that excludes the donor gives no extra message", async () => {
    const { rows, text } = await dashboard({ donor: ID0, status: "donated" });
    expect(rows).toHaveLength(0);
    expect(text).not.toContain("No donor has that CPR number.");
  });
  it("donor=none shows the message and an empty box", async () => {
    const { props, rows, text } = await dashboard({ donor: "none" });
    expect(rows).toHaveLength(0);
    expect(text).toContain("No donor has that CPR number.");
    expect(props.some((p) => p.name === "q" && p.defaultValue === "")).toBe(true);
  });
  it("donor=error shows the danger message", async () => {
    const { text } = await dashboard({ donor: "error" });
    expect(text).toContain("Could not look up that CPR number.");
  });
  it.each([UNKNOWN, "abc"])("donor=%s shows the link message", async (donor) => {
    const { rows, text } = await dashboard({ donor });
    expect(rows).toHaveLength(0);
    expect(text).toContain("No donor matches this link.");
  });
  it("a partial search is unchanged", async () => {
    const { rows } = await dashboard({ q: "1123" });
    expect(rows).toHaveLength(2);
  });
  it("the print page filters by donor", async () => {
    const { default: Page } = await import("@/app/admin/print/page");
    const one = flat(await Page({ searchParams: Promise.resolve({ donor: ID0 }) }));
    expect(one.props.filter((p) => p.donor !== undefined)).toHaveLength(1);
    const none = flat(await Page({ searchParams: Promise.resolve({ donor: UNKNOWN }) }));
    expect(none.props.filter((p) => p.donor !== undefined)).toHaveLength(0);
    expect(none.texts.join(" ")).toContain("No donors match the current search or filter.");
  });
});
