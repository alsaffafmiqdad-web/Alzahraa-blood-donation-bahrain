import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EventIntro } from "@/components/public/EventIntro";
import { getDictionary } from "@/lib/i18n";

const read = (p: string) => readFileSync(p, "utf8");
const form = read("components/public/SignupForm.tsx");
const ev = { name: "Drive", dateText: "16 October 2026", timeText: "8:30 AM", location: "Hall" };

describe("DOB focus wiring", () => {
  it("picks the ref per part: day -> dobRef, month -> dobMonthRef, year -> dobYearRef", () => {
    expect(form).toContain('ref={part === "day" ? dobRef : part === "month" ? dobMonthRef : dobYearRef}');
  });
  it("day advances to month, month advances to year, year does not advance", () => {
    expect(form).toMatch(/if \(part === "day"\) dobMonthRef\.current\?\.focus\(\);\s*else if \(part === "month"\) dobYearRef\.current\?\.focus\(\);/);
    expect(form).not.toMatch(/dobYearRef\.current\?\.focus\(\);\s*else if \(part === "year"\)/);
  });
  it("phone advances to email on the 8th digit; CPR to the day input", () => {
    expect(form).toContain("shouldAdvance(value, v.phone, 8, atEnd)) emailRef.current?.focus()");
    expect(form).toContain("shouldAdvance(value, v.cpr, 9, atEnd)) dobRef.current?.focus()");
    expect(form).toContain("ref={emailRef}");
  });
  it("picker has no name, min 1900, ltr, and swallows showPicker errors", () => {
    const picker = form.slice(form.indexOf('id="f-dob-picker"'), form.indexOf('id="f-dob-age"'));
    expect(picker).not.toMatch(/\bname=/);
    expect(picker).toContain('min="1900-01-01"');
    expect(picker).toContain("catch");
  });
});

describe("EventIntro documents card", () => {
  for (const locale of ["ar", "en"] as const) {
    const dict = getDictionary(locale);
    it(`shows the card when open (${locale}), also in walk-in mode`, () => {
      for (const walkIn of [false, true]) {
        const html = renderToStaticMarkup(<EventIntro dict={dict} event={ev} walkIn={walkIn} />);
        expect(html).toContain(dict.join.intro_docs_title);
        expect(html).toContain(dict.join.intro_doc_cpr);
        expect(html.indexOf("intro-docs-title")).toBeGreaterThan(html.indexOf("</dl>"));
      }
    });
    it(`hides the card when closed (${locale})`, () => {
      const html = renderToStaticMarkup(<EventIntro dict={dict} event={ev} walkIn={false} closed />);
      expect(html).not.toContain("intro-docs-title");
    });
  }
});

describe("copy", () => {
  it("name step copy and removed age_ok", () => {
    const ar = getDictionary("ar");
    const en = getDictionary("en");
    expect(ar.join.q_name).toBe("أدخل اسمك الثلاثي");
    expect(en.join.q_name).toBe("Enter your three-part name");
    expect(ar.join.ph_full_name).toBe("مثال: محمد علي حسن");
    expect(en.join.ph_full_name).toBe("e.g. Mohammed Ali Hasan");
    expect("age_ok" in ar.join).toBe(false);
    expect("age_ok" in en.join).toBe(false);
    expect(en.join.dob_picker).toBe("Choose from calendar");
  });
});

describe("event_location migration", () => {
  const sql = read("supabase/migrations/20261007000000_event_location.sql");
  it("only updates the original text and defines no functions", () => {
    expect(sql).toMatch(/where location_ar = 'حملة التبرع بالدم للرجال، صالة فاطمة كانو، توبلي'/);
    expect(sql).toContain("location_en = 'Fatima Kanoo Hall, Tubli'");
    expect(sql.toLowerCase()).not.toContain("create function");
  });
});
