import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/admin/actions", () => ({ updateStatusLabels: vi.fn() }));

import { StatusLabelsForm } from "@/components/admin/StatusLabelsForm";
import { STATUSES } from "@/lib/config";
import { DEFAULT_STATUS_LABELS } from "@/lib/status-labels";

describe("StatusLabelsForm", () => {
  const labels = { ...DEFAULT_STATUS_LABELS, waiting: "Desk A" };
  const html = renderToStaticMarkup(<StatusLabelsForm labels={labels} />);

  it("renders seven inputs named label_<status> with the given defaults and a 40 character limit", () => {
    expect(html.match(/<input[^>]*>/g)).toHaveLength(7);
    for (const s of STATUSES) {
      const input = html.match(new RegExp(`<input[^>]*name="label_${s}"[^>]*>`))?.[0] ?? "";
      expect(input, s).toContain(`value="${labels[s]}"`);
      expect(input, s).toContain('maxLength="40"');
      expect(input, s).toContain("required");
    }
  });
  it("shows the fixed status key in a code element, the hint and the save button", () => {
    for (const s of STATUSES) expect(html).toContain(`<code class="text-ink-soft">${s}</code>`);
    expect(html).toContain("The seven statuses are fixed");
    expect(html).toContain("Save status names");
  });
});
