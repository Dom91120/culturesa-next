import { ConnectedShell } from "@/components/connected-shell";
import { UserShell } from "@/components/user-shell";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/guards";
import { listBookableServices } from "@/server/services/bookings";
import type { Role } from "@prisma/client";

// « Mon compte » est accessible à TOUS les utilisateurs connectés (pas seulement aux
// gestionnaires) : la route vit donc hors du groupe (admin). On choisit ici le shell
// selon le rôle — admin (ConnectedShell) pour gestionnaire/administrateur, sinon le
// shell utilisateur (UserShell) avec ses activités réservables.
export default async function MonCompteLayout({ children }: { children: React.ReactNode }) {
  const session = await requireUser();
  const role = (session.user as { role?: Role }).role ?? "utilisateur";
  const user = { name: session.user.name ?? "", email: session.user.email };

  if (role === "gestionnaire" || role === "administrateur") {
    const services = await prisma.service.findMany({
      orderBy: [{ position: "asc" }, { label: "asc" }],
      select: { id: true, label: true, icon: true },
    });
    return (
      <ConnectedShell user={user} services={services} isAdmin={role === "administrateur"}>
        {children}
      </ConnectedShell>
    );
  }

  const services = await listBookableServices();
  return (
    <UserShell
      user={user}
      services={services.map((s) => ({ id: s.id, label: s.label, icon: s.icon }))}
    >
      {children}
    </UserShell>
  );
}
