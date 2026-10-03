import type { Metadata } from "next";
import "../globals.css";
import { plex } from "../fonts";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: "Organiser console",
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr" className={plex.variable}>
      <body className={plex.className + " min-h-screen bg-paper text-ink"}>
        {children}
        <Toaster position="top-center" />
      </body>
    </html>
  );
}
