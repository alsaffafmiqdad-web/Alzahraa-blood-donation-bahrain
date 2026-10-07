import { beforeEach, describe, expect, it, vi } from "vitest";

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
import { flushAfter } from "../helpers/after";
import { JPEG, multipartRequest } from "../helpers/multipart";

const good = {
  slotId: 3, fullName: "Ali Hasan", cpr: "990101123", dob: "1990-05-05", phone: "33334444",
  email: "ali@example.com", bloodType: "O+", recentDonation: false, onMedication: false, consent: true, token: "tok",
};
const ID = "abcdef12-3456-4890-8bcd-ef1234567890";

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

const notReached = () => {
  expect(m.verifyTurnstile).not.toHaveBeenCalled();
  expect(m.recordSignupAttempt).not.toHaveBeenCalled();
  expect(m.registerDonor).not.toHaveBeenCalled();
};

describe("signup CPR image: extra cases", () => {
  it("merges an invalid image with Zod errors, before rate limit / Turnstile / quota", async () => {
    const res = await POST(
      multipartRequest({ ...good, cpr: "123" }, { image: Uint8Array.from(Buffer.from("not an image at all")) }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("validation");
    expect(body.fields.cprImage).toBe("cpr_image_invalid");
    expect(body.fields.cpr).toBe("cpr_invalid");
    notReached();
  });

  it("merges a too-large image with Zod errors", async () => {
    const big = new Uint8Array(2_000_001);
    big.set(JPEG);
    const body = await (await POST(multipartRequest({ ...good, fullName: "" }, { image: big }))).json();
    expect(body.fields.cprImage).toBe("cpr_image_too_large");
    expect(body.fields.fullName).toBeTruthy();
    notReached();
  });

  it("merges a missing image with Zod errors (multipart)", async () => {
    const body = await (await POST(multipartRequest({ ...good, cpr: "1" }, { image: null }))).json();
    expect(body.fields.cprImage).toBe("cpr_image_required");
    expect(body.fields.cpr).toBe("cpr_invalid");
    notReached();
  });

  it("rejects a zero-byte image part as cpr_image_invalid", async () => {
    const res = await POST(multipartRequest(good, { image: new Uint8Array(0) }));
    expect(res.status).toBe(400);
    const f = (await res.json()).fields.cprImage;
    // an empty part may be treated as absent (required) or as empty (invalid); either way it must be rejected
    expect(["cpr_image_invalid", "cpr_image_required"]).toContain(f);
    notReached();
  });

  it("a text field named cprImage (not a file) is rejected", async () => {
    const boundary = "----textfieldboundary";
    const body =
      `--${boundary}\r\nContent-Disposition: form-data; name="payload"\r\n\r\n${JSON.stringify(good)}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="cprImage"\r\n\r\nhello\r\n--${boundary}--\r\n`;
    const res = await POST(
      new Request("http://x/api/signup", {
        method: "POST",
        headers: { "content-type": `multipart/form-data; boundary=${boundary}`, "content-length": String(Buffer.byteLength(body)) },
        body: Buffer.from(body),
      }),
    );
    expect(res.status).toBe(400);
    const j = await res.json();
    expect(j.fields.cprImage).toBe("cpr_image_invalid");
    notReached();
  });

  it("400 bad_json when the multipart payload is not JSON, 413 when the payload is oversize", async () => {
    const r1 = await POST(multipartRequest("{nope"));
    expect(r1.status).toBe(400);
    expect((await r1.json()).error).toBe("bad_json");
    const r2 = await POST(multipartRequest(JSON.stringify({ ...good, pad: "x".repeat(20_000) }), { contentLength: 40_000 }));
    expect(r2.status).toBe(413);
  });

  it("webp bytes are accepted and stored as webp", async () => {
    const webp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
    const res = await POST(multipartRequest(good, { image: webp, imageType: "application/octet-stream" }));
    expect(res.status).toBe(200);
    expect(m.attachCprImage.mock.calls[0]![2]).toBe("webp");
  });

  it("still 200 and sends the email when attachCprImage rejects the promise path (returns false)", async () => {
    m.attachCprImage.mockResolvedValue(false);
    const res = await POST(multipartRequest(good));
    expect(res.status).toBe(200);
    await flushAfter();
    expect(m.sendDonorEmail).toHaveBeenCalled();
  });
});
