import Link from "next/link";
import { SignOutButton } from "@/components/sign-out-button";
import { requireUser } from "@/server/guards";

const NAV = [
  { href: "/reserver", label: "Réserver" },
  { href: "/mes-reservations", label: "Mes réservations" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireUser();
  const role = (session.user as { role?: string }).role ?? "utilisateur";

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      <header className="border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-6 px-6 py-3">
          <Link href="/reserver" className="font-bold text-brand-700">
            CultuRésa
          </Link>
          <nav className="flex gap-4 text-sm">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-neutral-600 hover:text-brand-700 dark:text-neutral-300"
              >
                {item.label}
              </Link>
            ))}
            {role !== "utilisateur" && (
              <Link href="/services" className="text-neutral-400 hover:text-brand-700">
                Admin
              </Link>
            )}
          </nav>
          <div className="flex items-center gap-4">
            <span className="hidden text-sm text-neutral-500 sm:inline">{session.user.email}</span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-8">{children}</main>
    </div>
  );
}
