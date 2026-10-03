import { notFound } from "next/navigation";
import { RETENTION_MONTHS } from "@/lib/config";
import { publicEnv } from "@/lib/public-env";
import { getDictionary, isLocale, t } from "@/lib/i18n";

const SECTIONS = [
  ["who_h", "who_b"],
  ["collected_h", "collected_b"],
  ["why_h", "why_b"],
  ["who_sees_h", "who_sees_b"],
  ["health_h", "health_b"],
  ["storage_h", "storage_b"],
  ["retention_h", "retention_b"],
  ["rights_h", "rights_b"],
  ["no_sale_h", "no_sale_b"],
] as const;

export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const p = getDictionary(locale).privacy;
  const vars = {
    org: publicEnv.orgName || p.contact_missing,
    email: publicEnv.orgContactEmail || p.contact_missing,
    months: RETENTION_MONTHS,
  };
  return (
    <article className="space-y-5">
      <h1 className="text-2xl font-bold text-crimson">{p.title}</h1>
      {SECTIONS.map(([h, b]) => (
        <section key={h}>
          <h2 className="mb-1 font-bold">{p[h]}</h2>
          <p className="text-ink-soft">{t(p[b], vars)}</p>
        </section>
      ))}
    </article>
  );
}
