import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  checkSignupRateLimit: vi.fn(),
  recordSignupAttempt: vi.fn(),
  verifyTurnstile: vi.fn(),
  getEvent: vi.fn(),
  registerDonor: vi.fn(),
  sendDonorEmail: vi.fn(),
  attachCprImage: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkSignupRateLimit: m.checkSignupRateLimit,
  recordSignupAttempt: m.recordSignupAttempt,
  clientIp: () => "1.2.3.4",
}));
vi.mock("@/lib/turnstile", () => ({ verifyTurnstile: m.verifyTurnstile }));
vi.mock("@/lib/db/public", () => ({ getEvent: m.getEvent, registerDonor: m.registerDonor }));
vi.mock("@/lib/db/cpr-image", () => ({ attachCprImage: m.attachCprImage }));
vi.mock("@/lib/email/dispatch", () => ({ sendDonorEmail: m.sendDonorEmail }));

import { POST } from "@/app/api/signup/route";
import { JPEG, PNG, multipartRequest } from "../helpers/multipart";

const good = {
  slotId: 3,
  fullName: "Ali Hasan",
  cpr: "990101123",
  dob: "1990-05-05",
  phone: "33334444",
  email: "ali@example.com",
  bloodType: "O+",
  recentDonation: false,
  onMedication: false,
  consent: true,
  token: "tok",
};
const ID = "abcdef12-3456-4890-8bcd-ef1234567890";

/** Default: the multipart request the public form sends (with a valid JPEG). Explicit headers or a raw string: JSON. */
function req(body: unknown, headers?: Record<string, string>) {
  if (!headers && typeof body !== "string") return multipartRequest(body);
  return jsonReq(body, headers ?? { "content-type": "application/json" });
}
function jsonReq(body: unknown, headers: Record<string, string> = { "content-type": "application/json" }) {
  return new Request("http://x/api/signup", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  m.checkSignupRateLimit.mockResolvedValue(true);
  m.recordSignupAttempt.mockResolvedValue(true);
  m.verifyTurnstile.mockResolvedValue(true);
  m.getEvent.mockResolvedValue({ event_date: "2026-10-16", public_registration_open: true });
  m.registerDonor.mockResolvedValue({ ok: true, id: ID });
  m.sendDonorEmail.mockResolvedValue("sent");
  m.attachCprImage.mockResolvedValue(true);
});

describe("POST /api/signup", () => {
  it("429 when rate limited, before Turnstile", async () => {
    m.checkSignupRateLimit.mockResolvedValue(false);
    const res = await POST(req(good));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("600");
    expect(m.verifyTurnstile).not.toHaveBeenCalled();
  });
  it("429 when the counted attempt pushes the IP over the limit, after Turnstile and before any write", async () => {
    m.recordSignupAttempt.mockResolvedValue(false);
    const res = await POST(req(good));
    expect(res.status).toBe(429);
    expect(m.verifyTurnstile).toHaveBeenCalled();
    expect(m.registerDonor).not.toHaveBeenCalled();
  });
  it("only requests that pass Zod and Turnstile count against the quota", async () => {
    await POST(req({ ...good, cpr: "123" })); // Zod failure
    await POST(req("{nope")); // bad JSON
    await POST(req(good, { "content-type": "text/plain" })); // wrong type
    m.verifyTurnstile.mockResolvedValue(false);
    await POST(req(good)); // Turnstile failure
    expect(m.recordSignupAttempt).not.toHaveBeenCalled();
    m.verifyTurnstile.mockResolvedValue(true);
    await POST(req(good));
    expect(m.recordSignupAttempt).toHaveBeenCalledTimes(1);
    expect(m.recordSignupAttempt).toHaveBeenCalledWith("1.2.3.4");
  });
  it("413 on an oversize body", async () => {
    const res = await POST(req({ ...good, fullName: "a".repeat(11_000) }));
    expect(res.status).toBe(413);
  });
  it("400 on bad JSON", async () => {
    expect((await POST(req("{nope"))).status).toBe(400);
  });
  it("415 on the wrong content type", async () => {
    expect((await POST(req(good, { "content-type": "text/plain" }))).status).toBe(415);
  });
  it("400 with field codes on a Zod failure", async () => {
    const res = await POST(req({ ...good, cpr: "123" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("validation");
    expect(body.fields.cpr).toBe("cpr_invalid");
    expect(m.verifyTurnstile).not.toHaveBeenCalled();
  });
  it("403 when Turnstile fails, with no register", async () => {
    m.verifyTurnstile.mockResolvedValue(false);
    const res = await POST(req(good));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("turnstile");
    expect(m.registerDonor).not.toHaveBeenCalled();
  });
  it("403 when registration is closed", async () => {
    m.getEvent.mockResolvedValue({ event_date: "2026-10-16", public_registration_open: false });
    const res = await POST(req(good));
    expect(res.status).toBe(403);
    expect(m.registerDonor).not.toHaveBeenCalled();
  });
  it("409 duplicate_cpr, without donor data", async () => {
    m.registerDonor.mockResolvedValue({ ok: false, reason: "duplicate_cpr" });
    const res = await POST(req(good));
    expect(res.status).toBe(409);
    const text = JSON.stringify(await res.json());
    expect(text).toContain("duplicate_cpr");
    expect(text).not.toContain("Ali");
    expect(text).not.toContain("990101123");
  });
  it("409 slot_full and slot_unavailable", async () => {
    m.registerDonor.mockResolvedValue({ ok: false, reason: "slot_full" });
    expect((await POST(req(good))).status).toBe(409);
    m.registerDonor.mockResolvedValue({ ok: false, reason: "slot_unavailable" });
    expect((await POST(req(good))).status).toBe(409);
  });
  it("200 with email sent", async () => {
    const res = await POST(req(good));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ref: "ABCDEF12", slotId: 3, emailStatus: "sent" });
    expect(m.sendDonorEmail).toHaveBeenCalledWith(ID);
  });
  it("reports a failed email as queued", async () => {
    m.sendDonorEmail.mockResolvedValue("failed");
    const body = await (await POST(req(good))).json();
    expect(body.emailStatus).toBe("queued");
  });
  it("sends no email when there is no address", async () => {
    const { email, ...rest } = good;
    void email;
    const body = await (await POST(req(rest))).json();
    expect(body.emailStatus).toBe("none");
    expect(m.sendDonorEmail).not.toHaveBeenCalled();
  });
  it("computes flags on the server and rejects client-sent flags", async () => {
    const bad = await POST(req({ ...good, flagged: false }));
    expect(bad.status).toBe(400);
    await POST(req({ ...good, recentDonation: true }));
    expect(m.registerDonor).toHaveBeenCalledWith(
      expect.objectContaining({ flagged: true, flagReasons: ["recent_donation"], recentDonation: true }),
    );
    m.registerDonor.mockClear();
    await POST(req({ ...good, dob: "2010-01-01", onMedication: true }));
    expect(m.registerDonor).toHaveBeenCalledWith(
      expect.objectContaining({ flagged: true, flagReasons: ["on_medication", "age_out_of_range"] }),
    );
  });
  it("registers without flags when answers are safe", async () => {
    await POST(req(good));
    expect(m.registerDonor).toHaveBeenCalledWith(expect.objectContaining({ flagged: false, flagReasons: [] }));
  });
  it("500 generic when registerDonor throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    m.registerDonor.mockRejectedValue(new Error("db exploded for Ali 990101123"));
    const res = await POST(req(good));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: "server" });
  });

  describe("CPR card photo", () => {
    it("multipart with a valid JPEG attaches it to the new donor and returns 200", async () => {
      const res = await POST(multipartRequest(good));
      expect(res.status).toBe(200);
      expect(m.attachCprImage).toHaveBeenCalledTimes(1);
      const [id, bytes, ext] = m.attachCprImage.mock.calls[0]!;
      expect(id).toBe(ID);
      expect(ext).toBe("jpg");
      expect(Array.from(bytes as Uint8Array)).toEqual(Array.from(JPEG));
    });
    it("trusts the bytes, not the declared type: PNG labelled image/jpeg is stored as png", async () => {
      const res = await POST(multipartRequest(good, { image: PNG, imageType: "image/jpeg" }));
      expect(res.status).toBe(200);
      expect(m.attachCprImage.mock.calls[0]![2]).toBe("png");
    });
    it("400 cpr_image_invalid for non-image bytes, before Turnstile and the quota", async () => {
      const res = await POST(multipartRequest(good, { image: Uint8Array.from(Buffer.from("%PDF-1.4 hello")) }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("validation");
      expect(body.fields.cprImage).toBe("cpr_image_invalid");
      expect(m.verifyTurnstile).not.toHaveBeenCalled();
      expect(m.recordSignupAttempt).not.toHaveBeenCalled();
      expect(m.registerDonor).not.toHaveBeenCalled();
    });
    it("400 cpr_image_too_large over 2 MB", async () => {
      const big = new Uint8Array(2_000_001);
      big.set(JPEG);
      const res = await POST(multipartRequest(good, { image: big }));
      expect(res.status).toBe(400);
      expect((await res.json()).fields.cprImage).toBe("cpr_image_too_large");
      expect(m.attachCprImage).not.toHaveBeenCalled();
    });
    it("400 cpr_image_required when the photo is missing (multipart)", async () => {
      const res = await POST(multipartRequest(good, { image: null }));
      expect(res.status).toBe(400);
      expect((await res.json()).fields.cprImage).toBe("cpr_image_required");
      expect(m.verifyTurnstile).not.toHaveBeenCalled();
      expect(m.recordSignupAttempt).not.toHaveBeenCalled();
    });
    it("400 cpr_image_required for a JSON body, merged with Zod errors", async () => {
      const res = await POST(jsonReq({ ...good, cpr: "123" }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.fields.cprImage).toBe("cpr_image_required");
      expect(body.fields.cpr).toBe("cpr_invalid");
    });
    it("JSON with a valid body but no photo is rejected before Turnstile", async () => {
      const res = await POST(jsonReq(good));
      expect(res.status).toBe(400);
      expect((await res.json()).fields.cprImage).toBe("cpr_image_required");
      expect(m.verifyTurnstile).not.toHaveBeenCalled();
      expect(m.registerDonor).not.toHaveBeenCalled();
    });
    it("413 when Content-Length is missing or too large", async () => {
      expect((await POST(multipartRequest(good, { contentLength: null }))).status).toBe(413);
      expect((await POST(multipartRequest(good, { contentLength: 5_000_000 }))).status).toBe(413);
    });
    it("still 200 when the photo upload fails", async () => {
      m.attachCprImage.mockResolvedValue(false);
      const res = await POST(multipartRequest(good));
      expect(res.status).toBe(200);
      expect((await res.json()).ok).toBe(true);
    });
    it("uploads nothing when registration fails", async () => {
      m.registerDonor.mockResolvedValue({ ok: false, reason: "duplicate_cpr" });
      expect((await POST(multipartRequest(good))).status).toBe(409);
      expect(m.attachCprImage).not.toHaveBeenCalled();
    });
  });

  it("slot mode success body has no walkIn or queueNumber", async () => {
    const body = await (await POST(req(good))).json();
    expect(body).not.toHaveProperty("walkIn");
    expect(body).not.toHaveProperty("queueNumber");
  });

  describe("walk-in mode", () => {
    const { slotId, ...goodNoSlot } = good;
    void slotId;
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-16T06:00:00Z")); // 09:00 in Bahrain
      m.getEvent.mockResolvedValue({
        event_date: "2026-10-16",
        event_start_time: "08:30:00",
        public_registration_open: true,
      });
      m.registerDonor.mockResolvedValue({ ok: true, id: ID, queueNumber: 7 });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("registers a walk-in with no slot and returns the queue number", async () => {
      const res = await POST(multipartRequest(goodNoSlot));
      expect(res.status).toBe(200);
      expect(m.registerDonor).toHaveBeenCalledWith(expect.objectContaining({ slotId: null }));
      const body = await res.json();
      expect(body).toMatchObject({ ok: true, ref: "ABCDEF12", walkIn: true, queueNumber: 7, emailStatus: "sent" });
      expect(body).not.toHaveProperty("slotId");
      expect(m.sendDonorEmail).toHaveBeenCalledWith(ID);
      expect(m.attachCprImage).toHaveBeenCalledTimes(1);
    });
    it("the photo is optional (multipart)", async () => {
      const res = await POST(multipartRequest(goodNoSlot, { image: null }));
      expect(res.status).toBe(200);
      expect((await res.json()).walkIn).toBe(true);
      expect(m.attachCprImage).not.toHaveBeenCalled();
    });
    it("the photo is optional (JSON body)", async () => {
      expect((await POST(jsonReq(goodNoSlot))).status).toBe(200);
    });
    it("a sent but invalid photo is still rejected, before Turnstile", async () => {
      const res = await POST(multipartRequest(goodNoSlot, { image: Uint8Array.from([1, 2, 3]) }));
      expect(res.status).toBe(400);
      expect((await res.json()).fields.cprImage).toBe("cpr_image_invalid");
      expect(m.verifyTurnstile).not.toHaveBeenCalled();
    });
    it("ignores a stale or garbage slotId", async () => {
      expect((await POST(multipartRequest({ ...goodNoSlot, slotId: 3 }))).status).toBe(200);
      expect(m.registerDonor).toHaveBeenLastCalledWith(expect.objectContaining({ slotId: null }));
      expect((await POST(multipartRequest({ ...goodNoSlot, slotId: "garbage" }))).status).toBe(200);
    });
    it("400 on an unknown key", async () => {
      const res = await POST(multipartRequest({ ...goodNoSlot, flagged: false }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("validation");
    });
    it("before the start time the slot and photo are required again", async () => {
      vi.setSystemTime(new Date("2026-10-16T05:00:00Z")); // 08:00 in Bahrain
      const res = await POST(multipartRequest(goodNoSlot, { image: null }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.fields.slotId).toBe("slot_required");
      expect(body.fields.cprImage).toBe("cpr_image_required");
      expect(m.verifyTurnstile).not.toHaveBeenCalled();
    });
    it("is still walk-in mode at 23:59 Bahrain time", async () => {
      vi.setSystemTime(new Date("2026-10-16T20:59:00Z"));
      const res = await POST(multipartRequest(goodNoSlot, { image: null }));
      expect(res.status).toBe(200);
      expect(m.registerDonor).toHaveBeenLastCalledWith(expect.objectContaining({ slotId: null }));
    });
    it.each(["2026-10-16T21:00:00Z", "2026-10-17T06:00:00Z", "2026-10-15T09:00:00Z"])(
      "at %s (not the event day window) the slot and photo are required, so the client cannot force walk-in",
      async (now) => {
        vi.setSystemTime(new Date(now));
        const res = await POST(multipartRequest(goodNoSlot, { image: null }));
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.fields.slotId).toBe("slot_required");
        expect(body.fields.cprImage).toBe("cpr_image_required");
        expect(m.registerDonor).not.toHaveBeenCalled();
      },
    );
    it("a client cannot force slot mode either: slotId is ignored on the event day", async () => {
      const res = await POST(multipartRequest({ ...goodNoSlot, slotId: 1 }, { image: null }));
      expect(res.status).toBe(200);
      expect(m.registerDonor).toHaveBeenLastCalledWith(expect.objectContaining({ slotId: null }));
    });
    it("a missing start time keeps slot mode", async () => {
      m.getEvent.mockResolvedValue({ event_date: "2026-10-16", event_start_time: null, public_registration_open: true });
      expect((await POST(multipartRequest(goodNoSlot))).status).toBe(400);
    });
    it("403 registration_closed without registering", async () => {
      m.getEvent.mockResolvedValue({ event_date: "2026-10-16", event_start_time: "08:30:00", public_registration_open: false });
      const res = await POST(multipartRequest(goodNoSlot));
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe("registration_closed");
      expect(m.registerDonor).not.toHaveBeenCalled();
    });
    it("409 duplicate_cpr without a queue number", async () => {
      m.registerDonor.mockResolvedValue({ ok: false, reason: "duplicate_cpr" });
      const res = await POST(multipartRequest(goodNoSlot));
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body).toEqual({ ok: false, error: "duplicate_cpr" });
      expect(body).not.toHaveProperty("queueNumber");
    });
  });
});
