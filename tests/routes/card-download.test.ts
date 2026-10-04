import { beforeEach, describe, expect, it, vi } from "vitest";

/** Donor card download: the signed token, /api/card, and the digit-only CPR and phone inputs. */
const h = vi.hoisted(() => ({
  donor: null as Record<string, unknown> | null,
  renders: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/db/email", () => ({
  getDonorForEmail: async (id: string) => (h.donor && h.donor.id === id ? h.donor : null),
}));
vi.mock("@/lib/pdf/render", () => ({
  renderDonorCard: async (data: Record<string, unknown>) => {
    h.renders.push(data);
    return Buffer.from("%PDF-fake");
  },
}));

import { POST } from "@/app/api/card/route";
import { CARD_LINK_TTL_SECONDS, createCardToken, verifyCardToken } from "@/lib/card-link";
import { cprInput, phoneInput } from "@/lib/cpr";
import { resetEnvCache } from "@/lib/env";

const ID = "abcdef12-3456-4890-8bcd-ef1234567890";
const NOW = Date.UTC(2026, 9, 3, 12, 0, 0);

function setEnv(salt: string) {
  Object.assign(process.env, {
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    SUPABASE_SERVICE_ROLE_KEY: "svc",
    TURNSTILE_SECRET_KEY: "tsecret",
    RATE_LIMIT_SALT: salt,
    CRON_SECRET: "c",
  });
  resetEnvCache();
}

const post = (body: unknown, contentType = "application/json") =>
  POST(
    new Request("http://localhost/api/card", {
      method: "POST",
      headers: { "content-type": contentType },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  setEnv("salt-one");
  h.renders = [];
  h.donor = {
    id: ID,
    email: null,
    fullName: "علي حسن",
    bloodType: "O+",
    slotTime: "09:30:00",
    createdAt: "2026-10-03T10:00:00Z",
    event: { name_ar: "a", name_en: "b", location_ar: "", location_en: "", event_date: "2026-10-16" },
    cpr: "990101123",
    dob: "1990-05-05",
    phone: "33334444",
    source: "self_signup",
    queueNumber: null,
    flagged: false,
    flagReasons: [],
    notes: null,
  };
});

describe("card token", () => {
  it("round-trips a donor id", () => {
    expect(verifyCardToken(createCardToken(ID, NOW), NOW)).toBe(ID);
  });
  it("expires after the TTL", () => {
    const tok = createCardToken(ID, NOW);
    expect(verifyCardToken(tok, NOW + (CARD_LINK_TTL_SECONDS - 1) * 1000)).toBe(ID);
    expect(verifyCardToken(tok, NOW + (CARD_LINK_TTL_SECONDS + 1) * 1000)).toBeNull();
  });
  it("rejects tampering, a different key and junk", () => {
    const tok = createCardToken(ID, NOW);
    const [, exp, sig] = tok.split(".");
    expect(verifyCardToken(`11111111-2222-4333-8444-555555555555.${exp}.${sig}`, NOW)).toBeNull();
    expect(verifyCardToken(`${ID}.${Number(exp) + 9999}.${sig}`, NOW)).toBeNull();
    expect(verifyCardToken(`${ID}.${exp}.${sig!.slice(0, -1)}A`, NOW)).toBeNull();
    for (const junk of [undefined, null, 42, "", "a.b", `${ID}.x.y`, "x".repeat(500)]) {
      expect(verifyCardToken(junk, NOW)).toBeNull();
    }
    setEnv("salt-two");
    expect(verifyCardToken(tok, NOW)).toBeNull();
  });
});

describe("POST /api/card", () => {
  it("returns the donor card PDF for a valid token", async () => {
    const res = await post({ token: createCardToken(ID) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toContain('filename="donor-card.pdf"');
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("%PDF-fake");
    // Owner decision: the donor's PDF is the A4 registration form, full CPR included.
    expect(h.renders[0]).toMatchObject({
      donor: { fullName: "علي حسن", bloodType: "O+", ref: "ABCDEF12", cpr: "990101123", source: "self_signup" },
      event: { event_date: "2026-10-16" },
    });
  });
  it("refuses bad, expired or missing tokens without rendering", async () => {
    expect((await post({ token: "nope" })).status).toBe(403);
    expect((await post({ token: createCardToken(ID, NOW - (CARD_LINK_TTL_SECONDS + 60) * 1000) })).status).toBe(403);
    expect((await post({})).status).toBe(403);
    expect(h.renders).toEqual([]);
  });
  it("refuses non-JSON, bad JSON and oversized bodies", async () => {
    expect((await post("token=x", "application/x-www-form-urlencoded")).status).toBe(415);
    expect((await post("{not json")).status).toBe(400);
    expect((await post({ token: "x".repeat(2000) })).status).toBe(413);
  });
  it("404s when the donor no longer exists", async () => {
    const tok = createCardToken(ID);
    h.donor = null;
    expect((await post({ token: tok })).status).toBe(404);
  });
});

describe("digit-only inputs", () => {
  it("cpr keeps at most 9 ASCII digits", () => {
    expect(cprInput("990-101-123")).toBe("990101123");
    expect(cprInput("٩٩٠١٠١١٢٣")).toBe("990101123");
    expect(cprInput("99a01b01123456")).toBe("990101123");
  });
  it("phone keeps 8 digits and drops a pasted Bahrain code", () => {
    expect(phoneInput("+973 3333 4444")).toBe("33334444");
    expect(phoneInput("00973 3333 4444")).toBe("33334444");
    expect(phoneInput("3333-4444")).toBe("33334444");
    expect(phoneInput("٣٣٣٣٤٤٤٤")).toBe("33334444");
    expect(phoneInput("3333444455")).toBe("33334444");
    expect(phoneInput("abc")).toBe("");
  });
});
