import { requireRole } from "@/server/guards";
import { TachesSubnav } from "./taches-subnav";

/**
 * Onglet Administration › « Tâches planifiées » : sous-onglets CRON (planification
 * et suivi des tâches du conteneur cron) et Exports (dumps de la base).
 * Administration réservée aux administrateurs.
 */
export default async function TachesPlanifieesLayout({ children }: { children: React.ReactNode }) {
  await requireRole("administrateur");
  return (
    <div>
      <TachesSubnav />
      {children}
    </div>
  );
}
