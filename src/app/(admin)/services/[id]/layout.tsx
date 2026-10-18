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
 *
 * Ce garde de layout NE SUFFIT PAS : layout et page sont rendus en parallèle, et une
 * navigation RSC dont l'en-tête `Next-Router-State-Tree` déclare le layout déjà monté
 * ne le rend pas du tout — la page s'exécute alors seule. Chaque page.tsx lisant des
 * données appelle donc elle-même `requireServiceAccess` (ou `requireServiceManager`) ;
 * services/[id]/page-guards.test.ts le vérifie.
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
