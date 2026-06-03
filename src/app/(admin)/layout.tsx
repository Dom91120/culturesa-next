import { ConnectedShell } from "@/components/connected-shell";
import { prisma } from "@/server/db";
import { requireRole } from "@/server/guards";

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
    >
      {children}
    </ConnectedShell>
  );
}
