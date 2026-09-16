import { requireServiceAccess } from "@/server/guards";

/**
 * Point de contrôle unique pour TOUTES les pages d'un service (agenda, éditions, stats,
 * config, périodes, exercice, échanges, RGPD) : un gestionnaire ne peut ouvrir que les
 * services qui lui sont rattachés ; un administrateur, tous. Refus → redirection vers la
 * liste des services (cf. requireServiceAccess).
 *
 * Le layout n'exige que la CONSULTATION : un rattachement en lecture seule ouvre l'agenda,
 * les éditions et les statistiques. Les pages de paramétrage exigent chacune, en plus,
 * `requireServiceManager` (niveau gestion) — comme toutes les actions serveur.
 */
export default async function ServiceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireServiceAccess(id);
  return <>{children}</>;
}
