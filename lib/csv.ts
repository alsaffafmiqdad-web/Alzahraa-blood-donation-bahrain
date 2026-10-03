export type CsvCell = string | number | boolean | null | undefined;

const FORMULA_START = /^[=+\-@\t\r]/;

function cell(v: CsvCell): string {
  let s: string;
  if (v === null || v === undefined) s = "";
  else if (typeof v === "string") s = FORMULA_START.test(v) ? `'${v}` : v;
  else s = String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

/** Every cell quoted, CRLF endings, UTF-8 BOM so Excel shows Arabic. String cells starting with a formula character get a `'` prefix. */
export function toCsv(headers: string[], rows: CsvCell[][]): string {
  const lines = [headers, ...rows].map((r) => r.map(cell).join(","));
  return "﻿" + lines.join("\r\n") + "\r\n";
}
