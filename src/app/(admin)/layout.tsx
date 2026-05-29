import Link from "next/link";
import { SignOutButton } from "@/components/sign-out-button";
import { requireRole } from "@/server/guards";

const NAV = [
  { href: "/demandeurs", label: "Demandeurs" },
  { href: "/structures", label: "Structures" },
  { href: "/niveaux", label: "Niveaux" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Tout le back-office exige au minimum le rôle gestionnaire.
  const session = await requireRole("gestionnaire");

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      <header className="border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-6 px-6 py-3">
          <Link href="/" className="font-bold text-brand-700">
            CultuRésa <span className="font-normal text-neutral-400">admin</span>
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
          </nav>
          <div className="flex items-center gap-4">
            <span className="text-sm text-neutral-500">{session.user.email}</span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
