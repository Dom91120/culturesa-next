import { requireServiceManager } from "@/server/guards";

/**
 * Point de contrôle unique pour TOUTES les pages d'un service (agenda, créneaux,
 * réservations, config, périodes, exercice, thèmes, demandeurs, éditions, stats, RGPD) :
 * un gestionnaire ne peut ouvrir que les services qu'il gère ; un administrateur, tous.
 * Refus → redirection vers la liste des services (cf. requireServiceManager).
 */
export default async function ServiceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireServiceManager(id);
  return <>{children}</>;
}
