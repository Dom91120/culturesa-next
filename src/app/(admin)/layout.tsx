import { ConnectedShell } from "@/components/connected-shell";
import { OnboardingModal } from "@/components/onboarding-modal";
import { SessionWatchdog } from "@/components/session-watchdog";
import { prisma } from "@/server/db";
import { requireRole, sessionDeadline } from "@/server/guards";
import { listServicesForCurrentAdmin } from "@/server/services/services";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireRole("gestionnaire");
  const isAdmin = (session.user as { role?: string }).role === "administrateur";
  const deadline = await sessionDeadline();
  // Nav : un gestionnaire ne voit que les services qu'il gère ; un admin, tous.
  const services = await listServicesForCurrentAdmin();
  // Onboarding : modale de bienvenue (variante gestionnaire) à la 1re connexion. Lecture
  // tolérante : colonne onboardedAt absente (migration non appliquée) → onboarding désactivé.
  let needsOnboarding = false;
  try {
    const me = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { onboardedAt: true },
    });
    needsOnboarding = !me?.onboardedAt;
  } catch {
    needsOnboarding = false;
  }

  return (
    <ConnectedShell
      user={{
        name: session.user.name ?? "",
        email: session.user.email,
        role: isAdmin ? "administrateur" : "gestionnaire",
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
