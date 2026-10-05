import { AdminSidebar } from "@/components/admin/AdminSidebar";

export function AdminShell({
  displayName,
  children,
  wide = true,
}: {
  displayName: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <>
      <a
        href="#main"
        className="no-print sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:font-medium focus:shadow focus:outline-2 focus:outline-brand"
      >
        Skip to main content
      </a>
      <div className="min-h-dvh lg:flex print:block">
        <AdminSidebar displayName={displayName} />
        <div className="min-w-0 flex-1">
          <main
            id="main"
            tabIndex={-1}
            className={"mx-auto px-4 py-6 focus:outline-none print:p-0 " + (wide ? "max-w-7xl" : "max-w-3xl")}
          >
            {children}
          </main>
        </div>
      </div>
    </>
  );
}
