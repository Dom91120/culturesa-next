import { ConnectedShell } from "@/components/connected-shell";
import { OnboardingModalLazy } from "@/components/onboarding-modal-lazy";
import { SessionWatchdog } from "@/components/session-watchdog";
import { prisma } from "@/server/db";
import { requireRole, sessionDeadline } from "@/server/guards";
import { listServicesForCurrentAdmin } from "@/server/services/services";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireRole("gestionnaire");
  // Trois lectures indépendantes en une seule vague (le garde reste seul en tête — il
  // peut rediriger) ; auparavant en série (audit perf 2026-09-17).
  // - Nav : un gestionnaire ne voit que les services qu'il gère ; un admin, tous.
  // - Onboarding : modale de bienvenue (variante gestionnaire) à la 1re connexion. Lecture
  //   tolérante : colonne onboardedAt absente (migration non appliquée) → `undefined`,
  //   onboarding désactivé (null = compte introuvable, traité comme « pas encore vu »).
  //   Rôle lu EN BASE et non depuis la session : une session fraîchement créée peut porter
  //   un rôle vide — un admin venant de se connecter perdait ses onglets d'administration.
  const [deadline, services, me] = await Promise.all([
    sessionDeadline(),
    listServicesForCurrentAdmin(),
    prisma.user
      .findUnique({
        where: { id: session.user.id },
        select: { onboardedAt: true, role: true },
      })
      .catch(() => undefined),
  ]);
  const needsOnboarding = me !== undefined && !me?.onboardedAt;
  const role = me?.role || (session.user as { role?: string }).role || "gestionnaire";
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
      <OnboardingModalLazy
        variant={isAdmin ? "administrateur" : "gestionnaire"}
        open={needsOnboarding}
      />
      {deadline !== null && <SessionWatchdog expiresAt={deadline} />}
    </ConnectedShell>
  );
}
