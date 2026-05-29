import { ConnectedShell, type ShellTab } from "@/components/connected-shell";
import { prisma } from "@/server/db";
import { requireRole } from "@/server/guards";

const ADMIN_TABS: ShellTab[] = [
  { href: "/services", label: "Services", icon: "🏷️" },
  { href: "/users", label: "Comptes utilisateurs", icon: "👥" },
  { href: "/demandeurs", label: "Demandeurs", icon: "🏛️" },
  { href: "/messagerie", label: "Messagerie", icon: "✉️" },
  { href: "/configuration", label: "Configuration", icon: "⚙️" },
  { href: "/rgpd", label: "RGPD", icon: "🛡️" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireRole("gestionnaire");
  const services = await prisma.service.findMany({
    orderBy: [{ position: "asc" }, { label: "asc" }],
    select: { id: true, label: true, icon: true },
  });

  return (
    <ConnectedShell
      user={{ name: session.user.name ?? "", email: session.user.email }}
      services={services}
      tabs={ADMIN_TABS}
    >
      {children}
    </ConnectedShell>
  );
}
