import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const h = vi.hoisted(() => ({
  resendEmail: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  refresh: vi.fn(),
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useState: (v: unknown) => [v, () => {}],
    useTransition: () => [false, (fn: () => unknown) => fn()],
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh, push: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: h.toast }));
vi.mock("@/app/admin/actions", () => ({
  checkInDonor: vi.fn(),
  deleteDonor: vi.fn(),
  verifyDonor: vi.fn(),
  resendEmail: h.resendEmail,
}));
vi.mock("@/components/admin/StatusControl", () => ({ StatusControl: () => null }));

import { DonorActions } from "@/components/admin/DonorActions";

type Node = { props?: { children?: unknown; onClick?: () => unknown } } | null | undefined | string | unknown[];

function findResend(node: unknown): (() => unknown) | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = findResend(n);
      if (r) return r;
    }
    return null;
  }
  const el = node as Exclude<Node, string | unknown[] | null | undefined>;
  const children = el.props?.children;
  const text = Array.isArray(children) ? children.join("") : children;
  if (typeof text === "string" && /^Send email/.test(text) && el.props?.onClick) return el.props.onClick;
  return findResend(children);
}

async function clickResend() {
  const tree = DonorActions({
    donorId: "d1", name: "N", status: "registered", hasEmail: true, emailSent: false,
    labels: {} as never,
  }) as ReactElement;
  const onClick = findResend(tree);
  expect(onClick).toBeTruthy();
  await onClick!();
  await Promise.resolve();
}

beforeEach(() => vi.clearAllMocks());

describe("DonorActions send email toasts", () => {
  it("shows the Gmail login message on auth_failed", async () => {
    h.resendEmail.mockResolvedValue({ ok: false, outcome: "auth_failed" });
    await clickResend();
    expect(h.toast.error).toHaveBeenCalledWith("Email login failed. The Gmail app password needs to be updated.");
  });
  it("shows success on sent", async () => {
    h.resendEmail.mockResolvedValue({ ok: true, outcome: "sent" });
    await clickResend();
    expect(h.toast.success).toHaveBeenCalledWith("Email sent");
  });
  it("shows the generic failure on failed", async () => {
    h.resendEmail.mockResolvedValue({ ok: false, outcome: "failed" });
    await clickResend();
    expect(h.toast.error).toHaveBeenCalledWith("Email failed. See the error on this page.");
  });
});
