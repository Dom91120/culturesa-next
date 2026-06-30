import { OnboardingModal } from "@/components/onboarding-modal";
import { UserShell } from "@/components/user-shell";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/guards";
import { listBookableServices } from "@/server/services/bookings";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireUser();
  const services = await listBookableServices();
  // Onboarding : modale de bienvenue à la 1re connexion (onboardedAt null). Lecture
  // tolérante : si la colonne n'existe pas encore (migration non appliquée), on désactive
  // l'onboarding au lieu de casser la page.
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
    <UserShell
      user={{ name: session.user.name ?? "", email: session.user.email }}
      services={services.map((s) => ({ id: s.id, label: s.label, icon: s.icon }))}
    >
      {children}
      <OnboardingModal
        variant="usager"
        open={needsOnboarding}
        services={services.map((s) => ({ label: s.label, icon: s.icon }))}
      />
    </UserShell>
  );
}
