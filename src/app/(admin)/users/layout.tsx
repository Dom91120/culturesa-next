import { requireRole } from "@/server/guards";
import { UsersSubnav } from "./users-subnav";

/**
 * Onglet Administration › « Utilisateurs » : sous-onglets Comptes (gestion des comptes,
 * ancien contenu de l'onglet) et Connectés (sessions ouvertes). Réservé aux administrateurs.
 */
export default async function UsersLayout({ children }: { children: React.ReactNode }) {
  await requireRole("administrateur");
  return (
    <div>
      <UsersSubnav />
      {children}
    </div>
  );
}
