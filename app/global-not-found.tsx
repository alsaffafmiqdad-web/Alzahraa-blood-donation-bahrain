import "./globals.css";
import { thmanyahDisplay, thmanyahSans } from "./fonts";

export const metadata = { title: "404" };

export default function GlobalNotFound() {
  return (
    <html lang="en" className={`${thmanyahSans.variable} ${thmanyahDisplay.variable}`}>
      <body className="flex min-h-screen items-center justify-center bg-paper text-ink">
        <div className="space-y-2 p-6 text-center">
          <h1 className="text-3xl font-bold text-brand">404</h1>
          <p>Page not found</p>
          <p lang="ar" dir="rtl">
            الصفحة غير موجودة
          </p>
        </div>
      </body>
    </html>
  );
}
