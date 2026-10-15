import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ requireAdmin: vi.fn(), renderCertificate: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAdmin: h.requireAdmin }));
vi.mock("@/lib/pdf/render", () => ({ renderCertificate: h.renderCertificate }));
vi.mock("next/navigation", () => ({ redirect: () => undefined, notFound: () => undefined }));

import { GET } from "@/app/admin/donors/[id]/certificate/route";

const ID = "abcdef12-3456-4890-8bcd-ef1234567890";
const NAME = "Secret Donor Name";

function supabaseWith(result: { data: unknown; error: { message: string } | null }) {
  return {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => result }) }) }),
  };
}
const call = (id: string) => GET(new Request("http://localhost/x"), { params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  h.renderCertificate.mockResolvedValue(Buffer.from("%PDF-1.7 fake"));
});

describe("GET /admin/donors/[id]/certificate", () => {
  it("returns 401 when requireAdmin throws", async () => {
    h.requireAdmin.mockRejectedValue(new Error("NEXT_REDIRECT"));
    const res = await call(ID);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: "unauthorized" });
  });
  it("returns 404 for an id that is not a UUID", async () => {
    h.requireAdmin.mockResolvedValue({ supabase: supabaseWith({ data: null, error: null }) });
    expect((await call("not-a-uuid")).status).toBe(404);
  });
  it("returns 404 when there is no row", async () => {
    h.requireAdmin.mockResolvedValue({ supabase: supabaseWith({ data: null, error: null }) });
    expect((await call(ID)).status).toBe(404);
  });
  it("returns 500 on a DB error and logs the donor id but not the name", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.requireAdmin.mockResolvedValue({ supabase: supabaseWith({ data: null, error: { message: "boom" } }) });
    const res = await call(ID);
    expect(res.status).toBe(500);
    const logged = String(spy.mock.calls[0]?.[0]);
    expect(logged).toContain(ID);
    expect(logged).not.toContain(NAME);
    spy.mockRestore();
  });
  it("returns 500 when rendering throws, without logging the name", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.requireAdmin.mockResolvedValue({ supabase: supabaseWith({ data: { id: ID, full_name: NAME }, error: null }) });
    h.renderCertificate.mockRejectedValue(new Error("no background"));
    const res = await call(ID);
    expect(res.status).toBe(500);
    expect(String(spy.mock.calls[0]?.[0])).toContain(ID);
    expect(String(spy.mock.calls[0]?.[0])).not.toContain(NAME);
    spy.mockRestore();
  });
  it("returns the PDF inline with no-store", async () => {
    h.requireAdmin.mockResolvedValue({ supabase: supabaseWith({ data: { id: ID, full_name: NAME }, error: null }) });
    const res = await call(ID);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toMatch(/^inline; filename="certificate-[A-Za-z0-9]+\.pdf"$/);
    expect(res.headers.get("content-disposition")).not.toContain("Secret");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(h.renderCertificate).toHaveBeenCalledWith(NAME);
  });
  it("sets nosniff and keeps the name out of every response header", async () => {
    h.requireAdmin.mockResolvedValue({ supabase: supabaseWith({ data: { id: ID, full_name: NAME }, error: null }) });
    const res = await call(ID);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    for (const [, value] of res.headers.entries()) {
      expect(value).not.toContain("Secret");
      expect(value).not.toContain("Donor");
    }
  });
  it("never renders when unauthorised, for a bad id, or for a missing donor", async () => {
    h.requireAdmin.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await call(ID);
    h.requireAdmin.mockResolvedValue({ supabase: supabaseWith({ data: null, error: null }) });
    await call("not-a-uuid");
    await call(ID);
    expect(h.renderCertificate).not.toHaveBeenCalled();
  });
  it("does not touch the database for an invalid id", async () => {
    const from = vi.fn();
    h.requireAdmin.mockResolvedValue({ supabase: { from } });
    expect(await (await call("../../etc/passwd")).json()).toEqual({ ok: false, error: "not_found" });
    expect(from).not.toHaveBeenCalled();
  });
  it("looks the donor up by id and only selects id and full_name", async () => {
    const select = vi.fn(() => ({ eq }));
    const eq = vi.fn(() => ({ maybeSingle: async () => ({ data: { id: ID, full_name: NAME }, error: null }) }));
    const from = vi.fn(() => ({ select }));
    h.requireAdmin.mockResolvedValue({ supabase: { from } });
    await call(ID);
    expect(from).toHaveBeenCalledWith("donors");
    expect(select).toHaveBeenCalledWith("id, full_name");
    expect(eq).toHaveBeenCalledWith("id", ID);
  });
  it("returns the 404 and 500 bodies as JSON error codes", async () => {
    h.requireAdmin.mockResolvedValue({ supabase: supabaseWith({ data: null, error: null }) });
    expect(await (await call(ID)).json()).toEqual({ ok: false, error: "not_found" });
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.requireAdmin.mockResolvedValue({ supabase: supabaseWith({ data: null, error: { message: "boom" } }) });
    expect(await (await call(ID)).json()).toEqual({ ok: false, error: "server" });
    spy.mockRestore();
  });
});
