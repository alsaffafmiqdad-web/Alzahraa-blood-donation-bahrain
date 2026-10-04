import "server-only";
import { Document, Page, StyleSheet, Text, View, type Styles } from "@react-pdf/renderer";

import type { PrintDonor, PrintEvent } from "@/components/admin/PrintForm";
import { formatDateShort, formatSlot } from "@/lib/format";
import { en } from "@/lib/i18n/dictionaries/en";

/**
 * The A4 "Donor Registration Form" as a PDF, for the donor's download and confirmation email.
 * It mirrors `components/admin/PrintForm.tsx` (the reference) field for field; keep the two in step.
 * Sizes are the HTML's CSS px times 0.75 (1px prints as 0.75pt).
 */
export type RegistrationFormData = { donor: PrintDonor; event: PrintEvent; printedOn: string };

const CRIMSON = "#9C1F2E";
const CRIMSON_DARK = "#7A1622";
const FLAG_BG = "#F6D9A6";
const FLAG_INK = "#7A4A00";

// .print-page is max 190mm wide with 24px padding, centred on A4.
const PAGE_X = 46;
const CONTENT_W = 595.28 - PAGE_X * 2;
const COL_GAP = 18; // gap-x-6
const CELL_W = (CONTENT_W - COL_GAP) / 2;
const STAFF_GAP = 10.5; // gap-3.5
const STAFF_W = (CONTENT_W - STAFF_GAP * 2) / 3;
const STRONG_SIZE = 12; // text-base

const styles = StyleSheet.create({
  page: { fontFamily: "ThmanyahSans", fontSize: 10.5, color: "#1A1A1A", paddingTop: 36, paddingBottom: 36, paddingHorizontal: PAGE_X },
  head: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 2.25,
    borderBottomColor: CRIMSON,
    paddingBottom: 9,
    marginBottom: 12,
  },
  h2: { fontFamily: "ThmanyahDisplay", fontWeight: 400, fontSize: 16.5, marginBottom: 3 },
  sub: { fontSize: 9.75, color: "#555555" },
  idBox: { alignItems: "flex-end", fontSize: 9.75 },
  ref: { fontFamily: "ThmanyahDisplay", fontWeight: 700, fontSize: 13.5, color: CRIMSON },
  queue: { marginTop: 3, fontSize: 15, fontWeight: 700, color: CRIMSON },
  flag: {
    marginVertical: 7.5,
    borderRadius: 4.5,
    backgroundColor: FLAG_BG,
    paddingHorizontal: 9,
    paddingVertical: 6,
    fontSize: 9,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0.3,
    color: FLAG_INK,
  },
  section: {
    marginTop: 7.5,
    marginBottom: 4.5,
    borderBottomWidth: 0.75,
    borderBottomColor: "#DDDDDD",
    paddingBottom: 3,
    fontSize: 9,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0.375,
    color: CRIMSON_DARK,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 3 },
  cell: { width: CELL_W, borderBottomWidth: 0.75, borderBottomStyle: "dotted", borderBottomColor: "#CCCCCC", paddingVertical: 3 },
  label: { fontSize: 8.25, fontWeight: 700, textTransform: "uppercase", color: "#777777" },
  strong: { fontSize: STRONG_SIZE, fontWeight: 700, color: "#111111" },
  notes: { marginTop: 6, fontSize: 9 },
  staffGrid: { marginTop: 4.5, flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: STAFF_GAP },
  staffBox: { width: STAFF_W, borderBottomWidth: 0.75, borderBottomColor: "#999999", paddingBottom: 9 },
  staffLabel: { fontSize: 7.5, fontWeight: 700, color: "#777777" },
  signRow: { marginTop: 16.5, flexDirection: "row", justifyContent: "space-between", fontSize: 9.75 },
  sign: { width: "45%", borderTopWidth: 0.75, borderTopColor: "#333333", paddingTop: 4.5 },
  footer: { marginTop: 9, textAlign: "center", fontSize: 8.25, color: "#999999" },
  rtlRow: { flexDirection: "row-reverse", flexWrap: "wrap", alignSelf: "flex-start" },
  tokenRtl: { marginLeft: 3 },
});

const SOURCE = { self_signup: "Pre-registered", walk_in: "Walk-in", admin_added: "Staff added" } as const;
const STAFF_BOXES = ["HAEMOGLOBIN", "BLOOD PRESSURE", "PULSE", "WEIGHT", "BAG / UNIT NO.", "NOTES"];

const ARABIC_RE = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;

/**
 * react-pdf does not apply the bidi weak-type rules reliably: trailing ASCII punctuation lands on the
 * wrong side, and digit runs inside Arabic text swap places. For Arabic text each word goes in its own
 * Text, laid out right to left by a row-reverse flex row, with trailing punctuation as its own token.
 */
type Token = { text: string; glue: boolean };

function arabicTokens(text: string): Token[] {
  const tokens: Token[] = [];
  for (const raw of text.replace(/[()]/g, "").split(/\s+/).filter(Boolean)) {
    const m = /^(.*?)([.:!?,،؟]+)$/.exec(raw);
    if (m && m[1]) {
      // glue: no gap between the word and the punctuation token that follows it (to its left)
      tokens.push({ text: m[1], glue: true }, { text: m[2] as string, glue: false });
    } else tokens.push({ text: raw, glue: false });
  }
  return tokens;
}

/** The PDF equivalent of `dir="auto"`: Arabic text is laid out right to left, anything else as is. */
function AutoText({ text, style }: { text: string; style?: Styles[string] }) {
  if (!ARABIC_RE.test(text)) return <Text style={style}>{text}</Text>;
  return (
    <View style={styles.rtlRow}>
      {arabicTokens(text).map((tok, i) => (
        <Text key={i} style={[style ?? {}, tok.glue ? { marginLeft: 0 } : styles.tokenRtl]}>
          {tok.text}
        </Text>
      ))}
    </View>
  );
}

const GLYPH_EM = 0.62;
const MIN_CHARS = 1;

/**
 * Splits a single word that is wider than `width` at `fontSize` into chunks that fit, separated by
 * spaces, so it wraps instead of running off the page. Normal names are returned unchanged.
 */
export function hardBreakLongWords(name: string, width = CELL_W, fontSize = STRONG_SIZE): string {
  const maxChars = Math.max(MIN_CHARS, Math.floor(width / (fontSize * GLYPH_EM)));
  return name
    .split(/(\s+)/)
    .map((part) => {
      if (/^\s+$/.test(part) || part.length <= maxChars) return part;
      const chars = Array.from(part);
      const chunks: string[] = [];
      for (let i = 0; i < chars.length; i += maxChars) chunks.push(chars.slice(i, i + maxChars).join(""));
      return chunks.join(" ");
    })
    .join("");
}

export function RegistrationFormPdf({ data }: { data: RegistrationFormData }) {
  const { donor, event, printedOn } = data;
  const flagLabels = en.flags as Record<string, string>;
  const cells: { label: string; value: string; strong?: boolean; auto?: boolean }[] = [
    { label: "Full name", value: hardBreakLongWords(donor.fullName), strong: true, auto: true },
    { label: "CPR number", value: donor.cpr, strong: true },
    { label: "Date of birth", value: donor.dob ? formatDateShort(donor.dob) : "-" },
    { label: "Slot", value: donor.slotTime ? formatSlot(donor.slotTime, "en") : "-" },
    { label: "Mobile", value: donor.phone ?? "-" },
    { label: "Email", value: donor.email ?? "-" },
    { label: "Blood type", value: donor.bloodType === "unknown" ? "Unknown" : donor.bloodType },
    { label: "Registered on", value: formatDateShort(donor.createdAt) },
  ];

  return (
    <Document title={`Donor Registration Form ${donor.ref}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.head}>
          <View style={{ maxWidth: CONTENT_W * 0.7 }}>
            <AutoText text={event.name_ar} style={styles.h2} />
            <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
              <Text style={styles.sub}>
                {formatDateShort(event.event_date)}
                {event.location_ar ? " | " : ""}
              </Text>
              {event.location_ar ? <AutoText text={event.location_ar} style={styles.sub} /> : null}
            </View>
            <Text style={styles.sub}>Donor Registration Form</Text>
          </View>
          <View style={styles.idBox}>
            <Text>Donor ID</Text>
            <Text style={styles.ref}>#{donor.ref}</Text>
            <Text>{SOURCE[donor.source]}</Text>
            {donor.queueNumber !== null ? <Text style={styles.queue}>Queue #{donor.queueNumber}</Text> : null}
          </View>
        </View>

        {donor.flagged ? (
          <Text style={styles.flag}>
            Flagged for medical review: {donor.flagReasons.map((r) => flagLabels[r] ?? r).join("; ")}
          </Text>
        ) : null}

        <Text style={styles.section}>Donor details</Text>
        <View style={styles.grid}>
          {cells.map((c) => (
            <View key={c.label} style={styles.cell}>
              <Text style={styles.label}>{c.label}</Text>
              {c.auto ? (
                <AutoText text={c.value} style={c.strong ? styles.strong : undefined} />
              ) : (
                <Text style={c.strong ? styles.strong : undefined}>{c.value}</Text>
              )}
            </View>
          ))}
        </View>

        {donor.notes ? (
          <View style={[styles.notes, { flexDirection: "row", flexWrap: "wrap" }]}>
            <Text style={{ fontWeight: 700 }}>Notes: </Text>
            <AutoText text={donor.notes} />
          </View>
        ) : null}

        <Text style={styles.section}>For staff use</Text>
        <View style={styles.staffGrid}>
          {STAFF_BOXES.map((b) => (
            <View key={b} style={styles.staffBox}>
              <Text style={styles.staffLabel}>{b}</Text>
            </View>
          ))}
        </View>

        <View style={styles.signRow}>
          <Text style={styles.sign}>Donor signature</Text>
          <Text style={styles.sign}>Staff signature</Text>
        </View>
        <Text style={styles.footer}>Printed on {printedOn} | Donor Registry</Text>
      </Page>
    </Document>
  );
}
