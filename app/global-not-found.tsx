import "./globals.css";
import { plex } from "./fonts";

export const metadata = { title: "404" };

export default function GlobalNotFound() {
  return (
    <html lang="en" className={plex.variable}>
      <body className={plex.className + " flex min-h-screen items-center justify-center bg-paper text-ink"}>
        <div className="space-y-2 p-6 text-center">
          <h1 className="text-3xl font-bold text-crimson">404</h1>
          <p>Page not found</p>
          <p lang="ar" dir="rtl">
            الصفحة غير موجودة
          </p>
        </div>
      </body>
    </html>
  );
}
