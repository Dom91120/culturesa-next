import { OnboardingModalLazy } from "@/components/onboarding-modal-lazy";
import { SessionWatchdog } from "@/components/session-watchdog";
import { UserShell } from "@/components/user-shell";
import { prisma } from "@/server/db";
import { requireUser, sessionDeadline } from "@/server/guards";
import { listBookableServices, userHasAnyGauge } from "@/server/services/bookings";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireUser();
  // Quatre lectures indépendantes en une seule vague (le garde reste seul en tête — il
  // peut rediriger) ; échéance de session et fiche usager étaient en série (audit perf
  // 2026-09-17).
  // - Onboarding : modale de bienvenue à la 1re connexion (onboardedAt null). Lecture
  //   tolérante : si la colonne n'existe pas encore (migration non appliquée) → `undefined`,
  //   onboarding désactivé au lieu de casser la page (null = compte introuvable).
  // - Rôle lu EN BASE (pas depuis la session : une session fraîchement créée peut porter
  //   un rôle vide → le pied de sidebar affichait l'e-mail au lieu du libellé de rôle).
  const [services, hasGauge, deadline, me] = await Promise.all([
    listBookableServices(),
    userHasAnyGauge(),
    sessionDeadline(),
    prisma.user
      .findUnique({
        where: { id: session.user.id },
        select: { onboardedAt: true, role: true },
      })
      .catch(() => undefined),
  ]);
  const needsOnboarding = me !== undefined && !me?.onboardedAt;
  const role = me?.role ?? "utilisateur";
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
      <OnboardingModalLazy
        variant="usager"
        open={needsOnboarding}
        services={services.map((s) => ({ label: s.label }))}
        hasGauge={hasGauge}
      />
      {deadline !== null && <SessionWatchdog expiresAt={deadline} />}
    </UserShell>
  );
}
