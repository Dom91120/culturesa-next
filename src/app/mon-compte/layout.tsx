import { ConnectedShell } from "@/components/connected-shell";
import { OnboardingModal } from "@/components/onboarding-modal";
import { SessionWatchdog } from "@/components/session-watchdog";
import { UserShell } from "@/components/user-shell";
import type { Role } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { requireUser, sessionDeadline } from "@/server/guards";
import { listBookableServices, userHasAnyGauge } from "@/server/services/bookings";
import { listServicesForCurrentAdmin } from "@/server/services/services";

// « Mon compte » est accessible à TOUS les utilisateurs connectés (pas seulement aux
// gestionnaires) : la route vit donc hors du groupe (admin). On choisit ici le shell
// selon le rôle — admin (ConnectedShell) pour gestionnaire/administrateur, sinon le
// shell utilisateur (UserShell) avec ses activités réservables.
export default async function MonCompteLayout({ children }: { children: React.ReactNode }) {
  const session = await requireUser();
  // Rôle lu EN BASE (comme les layouts (app) et (admin)) : une session fraîchement
  // créée peut porter un rôle vide — le pied de sidebar affichait alors l'e-mail au
  // lieu du libellé, et un admin frais serait tombé sur le shell usager.
  let role: Role = (session.user as { role?: Role }).role || "utilisateur";
  try {
    const me = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true },
    });
    if (me?.role) role = me.role;
  } catch {
    /* colonne indisponible : on garde le rôle de session */
  }
  const user = { name: session.user.name ?? "", email: session.user.email, role };
  const deadline = await sessionDeadline();
  const watchdog = deadline !== null && <SessionWatchdog expiresAt={deadline} />;

  if (role === "gestionnaire" || role === "administrateur") {
    // Périmètre par rôle : un gestionnaire ne voit QUE ses services gérés (ServiceManager),
    // un administrateur les voit tous. (Auparavant : findMany sans filtre → un gestionnaire
    // voyait les onglets de tous les services depuis « Mon compte ».)
    const services = await listServicesForCurrentAdmin();
    return (
      <ConnectedShell user={user} services={services} isAdmin={role === "administrateur"}>
        {children}
        {/* Monté fermé : SEUL récepteur de « Revoir la présentation » sur cette page
            (sans lui, l'entrée du menu ne faisait rien depuis Mon compte). */}
        <OnboardingModal variant={role} open={false} />
        {watchdog}
      </ConnectedShell>
    );
  }

  const [services, hasGauge] = await Promise.all([listBookableServices(), userHasAnyGauge()]);
  return (
    <UserShell
      user={user}
      services={services.map((s) => ({ id: s.id, label: s.label, icon: s.icon }))}
    >
      {children}
      {/* Monté fermé : récepteur de « Revoir la présentation » (cf. branche admin). */}
      <OnboardingModal
        variant="usager"
        open={false}
        services={services.map((s) => ({ label: s.label }))}
        hasGauge={hasGauge}
      />
      {watchdog}
    </UserShell>
  );
}
