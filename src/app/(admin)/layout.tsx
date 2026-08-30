import { ConnectedShell } from "@/components/connected-shell";
import { OnboardingModal } from "@/components/onboarding-modal";
import { SessionWatchdog } from "@/components/session-watchdog";
import { prisma } from "@/server/db";
import { requireRole, sessionDeadline } from "@/server/guards";
import { listServicesForCurrentAdmin } from "@/server/services/services";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireRole("gestionnaire");
  const deadline = await sessionDeadline();
  // Nav : un gestionnaire ne voit que les services qu'il gère ; un admin, tous.
  const services = await listServicesForCurrentAdmin();
  // Onboarding : modale de bienvenue (variante gestionnaire) à la 1re connexion. Lecture
  // tolérante : colonne onboardedAt absente (migration non appliquée) → onboarding désactivé.
  // Rôle lu EN BASE et non depuis la session : une session fraîchement créée peut porter
  // un rôle vide — un admin venant de se connecter perdait ses onglets d'administration.
  let needsOnboarding = false;
  let role = (session.user as { role?: string }).role || "gestionnaire";
  try {
    const me = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { onboardedAt: true, role: true },
    });
    needsOnboarding = !me?.onboardedAt;
    if (me?.role) role = me.role;
  } catch {
    needsOnboarding = false;
  }
  const isAdmin = role === "administrateur";

  return (
    <ConnectedShell
      user={{
        name: session.user.name ?? "",
        email: session.user.email,
        role,
      }}
      services={services}
      isAdmin={isAdmin}
    >
      {children}
      <OnboardingModal
        variant={isAdmin ? "administrateur" : "gestionnaire"}
        open={needsOnboarding}
      />
      {deadline !== null && <SessionWatchdog expiresAt={deadline} />}
    </ConnectedShell>
  );
}
