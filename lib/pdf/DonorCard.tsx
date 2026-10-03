import "server-only";
import { Document, Page, StyleSheet, Text, View, type Styles } from "@react-pdf/renderer";

import { PDF_ARABIC_ENABLED } from "@/lib/config";
import { formatDate, formatSlot, todayInBahrain } from "@/lib/format";
import type { Dictionary, Locale } from "@/lib/i18n";
import { ar } from "@/lib/i18n/dictionaries/ar";
import { en } from "@/lib/i18n/dictionaries/en";

export type DonorCardData = {
  fullName: string;
  ref: string;
  bloodType: string /* 'unknown' or code */;
  slotTime: string | null /* 'HH:MM:SS' */;
  signupDate: string /* ISO */;
  event: { name_ar: string; name_en: string; location_ar: string; location_en: string; event_date: string };
  org: { name: string; email: string; phone: string };
};

const CRIMSON = "#9C1F2E";
const INK = "#241F1C";
const SOFT = "#6B6259";
const LINE = "#E1D5C6";

const styles = StyleSheet.create({
  page: { fontFamily: "PlexArabic", fontSize: 9, color: INK, paddingTop: 0, paddingBottom: 16, paddingHorizontal: 28 },
  rule: { height: 7, backgroundColor: CRIMSON, marginHorizontal: -28, marginBottom: 12 },
  title: { fontSize: 15, fontWeight: 700, color: CRIMSON, marginBottom: 3 },
  eventName: { fontSize: 10, fontWeight: 700, marginBottom: 1 },
  small: { fontSize: 8.5, color: SOFT, marginBottom: 1 },
  donor: { fontSize: 13, fontWeight: 700, marginTop: 6, marginBottom: 1 },
  ref: { fontSize: 12, fontWeight: 700, color: CRIMSON, marginBottom: 4 },
  rowRtl: { flexDirection: "row-reverse", flexWrap: "wrap", marginBottom: 1 },
  rowLtr: { flexDirection: "row", flexWrap: "wrap", marginBottom: 1 },
  tokenRtl: { marginLeft: 3 },
  tokenLtr: { marginRight: 3 },
  label: { color: SOFT },
  disclaimer: { fontSize: 7.5, color: SOFT, marginTop: 4 },
  divider: { borderTopWidth: 1, borderTopColor: LINE, marginVertical: 8 },
});

const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;

/**
 * react-pdf does not apply the bidi weak-type rules reliably: trailing ASCII punctuation lands on the
 * wrong side, and digit runs inside Arabic text swap places. For Arabic lines each word goes in its own
 * Text, laid out right to left by a row-reverse flex row, with trailing punctuation as its own token.
 */
type Token = { text: string; glue: boolean };

function arabicTokens(text: string): Token[] {
  const tokens: Token[] = [];
  for (const raw of text.replace(/[()]/g, "").split(/\s+/).filter(Boolean)) {
    const m = /^(.*?)([.:!?,\u060C\u061F]+)$/.exec(raw);
    if (m && m[1]) {
      // glue: no gap between the word and the punctuation token that follows it (to its left)
      tokens.push({ text: m[1], glue: true }, { text: m[2] as string, glue: false });
    } else tokens.push({ text: raw, glue: false });
  }
  return tokens;
}

function tokenStyle(tok: Token) {
  return tok.glue ? { marginLeft: 0 } : styles.tokenRtl;
}

function Line({ text, rtl, style, color }: { text: string; rtl: boolean; style?: Styles[string]; color?: string }) {
  if (!rtl) return <Text style={[style ?? {}, { textAlign: "left" }]}>{text}</Text>;
  return (
    <View style={styles.rowRtl}>
      {arabicTokens(text).map((tok, i) => (
        <Text key={i} style={[style ?? {}, tokenStyle(tok), color ? { color } : {}]}>
          {tok.text}
        </Text>
      ))}
    </View>
  );
}

function Row({ label, value, rtl }: { label: string; value: string; rtl: boolean }) {
  if (!rtl) {
    return (
      <View style={styles.rowLtr}>
        <Text style={[styles.label, styles.tokenLtr]}>{label}</Text>
        <Text>{value}</Text>
      </View>
    );
  }
  return (
    <View style={styles.rowRtl}>
      <Text style={[styles.label, styles.tokenRtl]}>{label}</Text>
      {arabicTokens(value).map((tok, i) => (
        <Text key={i} style={tokenStyle(tok)}>
          {tok.text}
        </Text>
      ))}
    </View>
  );
}

/** Arabic label read right to left, then each contact item as one left-to-right unit. */
function ContactRtl({ label, items }: { label: string; items: string[] }) {
  return (
    <View style={styles.rowRtl}>
      {arabicTokens(label).map((tok, i) => (
        <Text key={`l${i}`} style={[styles.disclaimer, tokenStyle(tok)]}>
          {tok.text}
        </Text>
      ))}
      {items.map((item, i) => (
        <View key={`i${i}`} style={{ flexDirection: "row-reverse" }}>
          {i > 0 ? <Text style={[styles.disclaimer, styles.tokenRtl]}>|</Text> : null}
          <Text style={[styles.disclaimer, styles.tokenRtl, { textAlign: "left" }]}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

const GLYPH_EM = 0.62;
const NAME_WIDTH = 363; // A5 width minus page padding, in points
const NAME_SIZE = 13;
const NAME_MIN_SIZE = 6;

/** Rough glyph width for Plex Arabic (bold): about 0.62 em per character, on the safe side. */
function nameFontSize(name: string): number {
  const longest = Math.max(...name.split(/\s+/).map((w) => w.length), 1);
  return Math.max(NAME_MIN_SIZE, Math.min(NAME_SIZE, NAME_WIDTH / (longest * GLYPH_EM)));
}

/**
 * Last resort, only when a single word is still wider than the line at the font floor: split it into
 * chunks that fit, separated by spaces, so the text wraps instead of being clipped. Normal names are
 * returned unchanged.
 */
export function hardBreakLongWords(name: string): string {
  const maxChars = Math.max(1, Math.floor(NAME_WIDTH / (NAME_MIN_SIZE * GLYPH_EM)));
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

/** Wraps only at word boundaries; shrinks the font when a single word would not fit the line. */
function NameLine({ name: rawName, align }: { name: string; align: "left" | "right" }) {
  const name = hardBreakLongWords(rawName);
  const fontSize = nameFontSize(name);
  if (!ARABIC_RE.test(name)) {
    return <Text style={[styles.donor, { textAlign: align, fontSize }]}>{name}</Text>;
  }
  return (
    <View style={[styles.rowRtl, { marginTop: 6, marginBottom: 1 }]}>
      {name
        .split(/\s+/)
        .filter(Boolean)
        .map((w, i) => (
          <Text key={i} style={[styles.donor, styles.tokenRtl, { marginTop: 0, marginBottom: 0, fontSize }]}>
            {w}
          </Text>
        ))}
    </View>
  );
}

function Block({ data, locale }: { data: DonorCardData; locale: Locale }) {
  const d: Dictionary = locale === "ar" ? ar : en;
  const rtl = locale === "ar";
  const align = rtl ? "right" : "left";
  const eventName = rtl ? data.event.name_ar : data.event.name_en;
  const location = rtl ? data.event.location_ar : data.event.location_en;
  // The donor name is its own Text, aligned right when it contains Arabic, in both blocks.
  const nameAlign = ARABIC_RE.test(data.fullName) ? "right" : align;
  const bloodValue = data.bloodType === "unknown" ? d.pdf.unknown : data.bloodType;
  const signup = formatDate(todayInBahrain(new Date(data.signupDate)), locale);
  const contactItems = [data.org.name, data.org.email, data.org.phone].filter(Boolean);
  const contact = contactItems.join("   |   ");

  return (
    <View>
      <Text style={[styles.title, { textAlign: align }]}>{d.pdf.title}</Text>
      <Line text={eventName} rtl={rtl} style={styles.eventName} />
      <Line text={formatDate(data.event.event_date, locale)} rtl={rtl} style={styles.small} />
      {location ? <Line text={location} rtl={rtl} style={styles.small} /> : null}
      <NameLine name={data.fullName} align={nameAlign} />
      <Text style={[styles.ref, { textAlign: align }]}>{`#${data.ref}`}</Text>
      {data.slotTime ? <Row label={d.pdf.time} value={formatSlot(data.slotTime, locale)} rtl={rtl} /> : null}
      <Row label={d.pdf.blood_type} value={bloodValue} rtl={rtl} />
      {data.bloodType !== "unknown" ? <Line text={d.pdf.self_reported} rtl={rtl} style={styles.small} /> : null}
      <Row label={d.pdf.signup_date} value={signup} rtl={rtl} />
      <View style={{ marginTop: 4 }}>
        <Line text={d.pdf.bring_cpr} rtl={rtl} />
      </View>
      <View style={{ marginTop: 3 }}>
        <Line text={d.common.disclaimer} rtl={rtl} style={styles.disclaimer} />
      </View>
      {contact && rtl ? (
        <ContactRtl label={`${d.pdf.contact}:`} items={contactItems} />
      ) : contact ? (
        <Text style={[styles.disclaimer, { textAlign: align }]}>{`${d.pdf.contact}: ${contact}`}</Text>
      ) : null}
    </View>
  );
}

export function DonorCard({ data }: { data: DonorCardData }) {
  return (
    <Document title={`Donor card ${data.ref}`} author={data.org.name || undefined}>
      <Page size="A5" style={styles.page}>
        <View style={styles.rule} fixed />
        {PDF_ARABIC_ENABLED ? (
          <>
            <Block data={data} locale="ar" />
            <View style={styles.divider} />
          </>
        ) : null}
        <Block data={data} locale="en" />
      </Page>
    </Document>
  );
}
