import { UserShell } from "@/components/user-shell";
import { requireUser } from "@/server/guards";
import { listBookableServices } from "@/server/services/bookings";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireUser();
  const services = await listBookableServices();
  return (
    <UserShell
      user={{ name: session.user.name ?? "", email: session.user.email }}
      services={services.map((s) => ({ id: s.id, label: s.label, icon: s.icon }))}
    >
      {children}
    </UserShell>
  );
}
