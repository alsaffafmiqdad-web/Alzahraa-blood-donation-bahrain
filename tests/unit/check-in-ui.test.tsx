import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * StatusControl and DonorTable are client components. There is no DOM in this suite, so the hooks are
 * stubbed (state setters are spies, transitions run immediately) and the components are called as
 * functions; their returned element trees are searched for the handlers a user would trigger.
 */
const h = vi.hoisted(() => ({
  setters: [] as ReturnType<typeof vi.fn>[],
  pending: [] as Promise<unknown>[],
  checkInDonor: vi.fn(),
  setDonorStatus: vi.fn(),
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

vi.mock("react", async (orig) => {
  const actual = await orig<typeof import("react")>();
  return {
    ...actual,
    useState: (init: unknown) => {
      const set = vi.fn();
      h.setters.push(set);
      return [init, set];
    },
    useTransition: () => [false, (fn: () => Promise<void>) => void h.pending.push(fn())],
  };
});
vi.mock("sonner", () => ({ toast: h.toast }));
vi.mock("next/link", () => ({ default: () => null }));
vi.mock("@/app/admin/actions", () => ({ checkInDonor: h.checkInDonor, setDonorStatus: h.setDonorStatus }));

import { DonorTable } from "@/components/admin/DonorTable";
import { StatusControl } from "@/components/admin/StatusControl";
import type { DonorListRow } from "@/lib/donor-filters";

type El = ReactElement<{ children?: ReactNode; [k: string]: unknown }>;

function find(node: ReactNode, pred: (e: El) => boolean, out: El[] = []): El[] {
  if (Array.isArray(node)) node.forEach((n) => find(n, pred, out));
  else if (node && typeof node === "object" && "props" in node) {
    const el = node as El;
    if (pred(el)) out.push(el);
    find(el.props.children, pred, out);
  }
  return out;
}

const row = (status: DonorListRow["status"], id = "id-" + status): DonorListRow => ({
  id,
  seq: 1,
  ref: "ABCDEF12",
  fullName: "Ali Hasan",
  cpr: "990101234",
  phone: null,
  email: null,
  bloodType: "O+",
  slotId: 1,
  slotTime: "09:00:00",
  source: "self_signup",
  status,
  queueNumber: null,
  flagged: false,
  flagReasons: [],
  emailSent: false,
  createdAt: "2026-10-03T10:00:00Z",
});

beforeEach(() => {
  vi.clearAllMocks();
  h.setters.length = 0;
  h.pending.length = 0;
});

describe("StatusControl: choosing Waiting", () => {
  const choose = async (status: DonorListRow["status"]) => {
    const tree = StatusControl({ donorId: "d1", name: "Ali", status }) as ReactElement;
    const select = find(tree, (e) => e.type === "select")[0]!;
    (select.props.onChange as (e: unknown) => void)({ target: { value: "waiting" } });
    await Promise.all(h.pending);
    // setters[0] is the select value; the calls tell us what the select ends up showing
    return h.setters[0]!.mock.calls.map((c) => c[0]);
  };

  it("late no_show donor: checked in, shows Waiting, success toast with the real number", async () => {
    h.checkInDonor.mockResolvedValue({ ok: true, queueNumber: 12, alreadyCheckedIn: false, status: "waiting" });
    const shown = await choose("no_show");
    expect(shown.at(-1)).toBe("waiting");
    expect(h.toast.success).toHaveBeenCalledWith("Ali checked in, queue #12");
    expect(h.toast.error).not.toHaveBeenCalled();
  });
  it("refused (deferred): reverts the select and shows the real error, never 'queue #null'", async () => {
    h.checkInDonor.mockResolvedValue({ ok: true, queueNumber: null, alreadyCheckedIn: true, status: "deferred" });
    const shown = await choose("deferred");
    expect(shown.at(-1)).toBe("deferred");
    expect(h.toast.success).not.toHaveBeenCalled();
    const msg = h.toast.error.mock.calls[0]![0] as string;
    expect(msg).toContain("cannot be checked in");
    expect(msg).not.toContain("null");
  });
  it("refused with a server error: reverts and shows that error", async () => {
    h.checkInDonor.mockResolvedValue({ ok: false, error: "Check-in failed" });
    const shown = await choose("no_show");
    expect(shown.at(-1)).toBe("no_show");
    expect(h.toast.error).toHaveBeenCalledWith("Check-in failed");
  });
  it("already waiting: info toast, select stays Waiting", async () => {
    h.checkInDonor.mockResolvedValue({ ok: true, queueNumber: 3, alreadyCheckedIn: true, status: "waiting" });
    const shown = await choose("verified");
    expect(shown.at(-1)).toBe("waiting");
    expect(h.toast.info).toHaveBeenCalledWith("Ali is already checked in, queue #3");
  });
});

describe("DonorTable check-in button", () => {
  const table = (rows: DonorListRow[]) => DonorTable({ rows, totalCount: rows.length }) as ReactElement;
  const buttons = (tree: ReactElement) =>
    find(tree, (e) => typeof e.type === "function" && (e.type as { name: string }).name === "CheckInButton");

  it("is offered for registered, verified and no_show donors, not for deferred or waiting", () => {
    const tree = table(["registered", "verified", "no_show", "deferred", "waiting", "donated"].map((s) => row(s as never)));
    expect(buttons(tree)).toHaveLength(3);
  });

  const click = async (res: unknown) => {
    h.checkInDonor.mockResolvedValue(res);
    const el = buttons(table([row("no_show")]))[0]!;
    const rendered = (el.type as (p: unknown) => ReactElement<{ onClick: () => void }>)(el.props);
    rendered.props.onClick();
    await Promise.all(h.pending);
  };

  it("success toast carries the real queue number", async () => {
    await click({ ok: true, queueNumber: 9, alreadyCheckedIn: false, status: "waiting" });
    expect(h.toast.success).toHaveBeenCalledWith("Ali Hasan checked in, queue #9");
  });
  it("a refused check-in shows the real error, never 'queue #null'", async () => {
    await click({ ok: true, queueNumber: null, alreadyCheckedIn: true, status: "deferred" });
    expect(h.toast.success).not.toHaveBeenCalled();
    expect(h.toast.error.mock.calls[0]![0]).toContain("Deferred");
  });
  it("a server error is shown as is", async () => {
    await click({ ok: false, error: "Donor not found" });
    expect(h.toast.error).toHaveBeenCalledWith("Donor not found");
  });
});

describe("source rule", () => {
  it("no component interpolates a raw queue number into a toast", async () => {
    const { readFileSync } = await import("node:fs");
    for (const f of ["StatusControl", "DonorTable", "DonorActions"]) {
      const src = readFileSync(`components/admin/${f}.tsx`, "utf8");
      expect(src, f).not.toMatch(/queue #\$\{/);
    }
  });
});
