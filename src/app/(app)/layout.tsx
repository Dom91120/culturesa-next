import { OnboardingModal } from "@/components/onboarding-modal";
import { SessionWatchdog } from "@/components/session-watchdog";
import { UserShell } from "@/components/user-shell";
import { prisma } from "@/server/db";
import { requireUser, sessionDeadline } from "@/server/guards";
import { listBookableServices, userHasAnyGauge } from "@/server/services/bookings";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireUser();
  const [services, hasGauge] = await Promise.all([listBookableServices(), userHasAnyGauge()]);
  const deadline = await sessionDeadline();
  // Onboarding : modale de bienvenue à la 1re connexion (onboardedAt null). Lecture
  // tolérante : si la colonne n'existe pas encore (migration non appliquée), on désactive
  // l'onboarding au lieu de casser la page.
  let needsOnboarding = false;
  // Rôle lu EN BASE (pas depuis la session : une session fraîchement créée peut porter
  // un rôle vide → le pied de sidebar affichait l'e-mail au lieu du libellé de rôle).
  let role = "utilisateur";
  try {
    const me = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { onboardedAt: true, role: true },
    });
    needsOnboarding = !me?.onboardedAt;
    role = me?.role ?? "utilisateur";
  } catch {
    needsOnboarding = false;
  }
  return (
    <UserShell
      user={{
        name: session.user.name ?? "",
        email: session.user.email,
        // Côté réservations, un gestionnaire/admin garde son libellé de rôle.
        role,
      }}
      services={services.map((s) => ({ id: s.id, label: s.label, icon: s.icon }))}
    >
      {children}
      <OnboardingModal
        variant="usager"
        open={needsOnboarding}
        services={services.map((s) => ({ label: s.label }))}
        hasGauge={hasGauge}
      />
      {deadline !== null && <SessionWatchdog expiresAt={deadline} />}
    </UserShell>
  );
}
