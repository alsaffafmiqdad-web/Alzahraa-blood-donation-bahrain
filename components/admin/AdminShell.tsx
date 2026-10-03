import Link from "next/link";
import { Droplet } from "lucide-react";
import { signOut } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";

const NAV = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/donors/new", label: "Add donor" },
  { href: "/admin/slots", label: "Slots" },
  { href: "/admin/event", label: "Event" },
  { href: "/admin/account", label: "Account" },
];

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
      <header className="no-print border-b border-line bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/admin" className="flex items-center gap-2 font-bold text-crimson">
            <Droplet className="size-5 fill-crimson" aria-hidden="true" />
            Organiser console
          </Link>
          <nav className="flex flex-wrap gap-4 text-sm">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="text-ink-soft hover:text-crimson">
                {n.label}
              </Link>
            ))}
          </nav>
          <form action={signOut} className="ms-auto flex items-center gap-3 text-sm">
            <span className="text-ink-soft">{displayName}</span>
            <Button type="submit" variant="outline" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      </header>
      <main className={"mx-auto px-4 py-6 " + (wide ? "max-w-7xl" : "max-w-3xl")}>{children}</main>
    </>
  );
}
