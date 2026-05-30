import { UserShell } from "@/components/user-shell";
import { requireUser } from "@/server/guards";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireUser();
  return (
    <UserShell user={{ name: session.user.name ?? "", email: session.user.email }}>
      {children}
    </UserShell>
  );
}
