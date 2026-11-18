import { requireServiceAccess } from "@/server/guards";
import { InscritsScreen, type InscritsSearchParams } from "../inscrits-screen";

export const metadata = { title: "CultuRésa — Inscrits" };

// Édition « Liste des inscrits » : tous les usagers ayant réservé sur l'exercice.
// L'écran est partagé avec l'édition des accueils de loisirs (cf. inscrits-screen.tsx).
export default async function EditionsInscritsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<InscritsSearchParams>;
}) {
  const { id } = await params;
  // Garde PROPRE à la page : le layout ne suffit pas (cf. services/[id]/layout.tsx).
  // `requireServiceAccess` : la Direction des accueils de loisirs est refusée ici.
  await requireServiceAccess(id);
  return <InscritsScreen id={id} sp={await searchParams} />;
}
