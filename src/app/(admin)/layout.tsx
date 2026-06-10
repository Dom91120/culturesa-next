import { ConnectedShell } from "@/components/connected-shell";
import { requireRole } from "@/server/guards";
import { listServicesForCurrentAdmin } from "@/server/services/services";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireRole("gestionnaire");
  // Nav : un gestionnaire ne voit que les services qu'il gère ; un admin, tous.
  const services = await listServicesForCurrentAdmin();

  return (
    <ConnectedShell
      user={{ name: session.user.name ?? "", email: session.user.email }}
      services={services}
    >
      {children}
    </ConnectedShell>
  );
}
