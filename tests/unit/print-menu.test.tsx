import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PrintMenu } from "@/components/admin/PrintMenu";

describe("PrintMenu", () => {
  it("renders the Print trigger with its aria-label", () => {
    const html = renderToStaticMarkup(
      <PrintMenu cardHref="/c" certificateHref="/d" size="sm" label="Print options for Ali" />,
    );
    expect(html).toContain("Print");
    expect(html).toContain('aria-label="Print options for Ali"');
    expect(html).toContain("<button");
  });
});
