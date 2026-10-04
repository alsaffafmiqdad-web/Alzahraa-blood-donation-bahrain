import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/admin/actions", () => ({ updateQueueStart: vi.fn() }));

import { QueueStartForm } from "@/components/admin/QueueStartForm";

describe("QueueStartForm", () => {
  it("renders the number input with limits and the hint", () => {
    const html = renderToStaticMarkup(<QueueStartForm queueStart={1} nextNumber={42} />);
    for (const part of ['name="queue_start"', 'value="1"', 'min="1"', 'max="99999"', 'aria-describedby="queue_start-hint"', "The next number issued is 42"]) {
      expect(html).toContain(part);
    }
  });
});
