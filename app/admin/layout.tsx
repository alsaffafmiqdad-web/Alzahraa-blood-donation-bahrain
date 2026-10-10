import type { Metadata } from "next";
import "../globals.css";
import { thmanyahDisplay, thmanyahSans } from "../fonts";
import { getSiteSettings } from "@/lib/db/public";
import { themeCss } from "@/lib/theme";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: "Organiser console",
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const settings = await getSiteSettings();
  return (
    <html lang="en" dir="ltr" className={`${thmanyahSans.variable} ${thmanyahDisplay.variable}`}>
      <head>
        <style dangerouslySetInnerHTML={{ __html: themeCss(settings) }} />
      </head>
      <body className="min-h-screen bg-paper text-ink">
        {children}
        <Toaster position="top-center" />
      </body>
    </html>
  );
}
