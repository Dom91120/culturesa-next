import { requireServiceView } from "@/server/guards";
import { loisirsDemandeurIds } from "@/server/services/loisirs-scope";
import { InscritsScreen, type InscritsSearchParams } from "../inscrits-screen";

export const metadata = { title: "CultuRésa — Inscrits des accueils de loisirs" };

// Édition « Inscrits des accueils de loisirs » (Dom 2026-11-18) : la liste des inscrits
// restreinte aux usagers rattachés à un accueil de loisirs. C'est la SEULE édition
// ouverte à la Direction des accueils de loisirs, et la seule carte de son onglet
// Éditions. Gestionnaires et administrateurs peuvent l'ouvrir par son adresse (aucune
// donnée qu'ils ne voient déjà dans la liste complète), sans carte dans leur onglet.
export default async function EditionsLoisirsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<InscritsSearchParams>;
}) {
  const { id } = await params;
  // Garde PROPRE à la page : le layout ne suffit pas (cf. services/[id]/layout.tsx).
  const { loisirsScope } = await requireServiceView(id);
  // Le périmètre vient TOUJOURS du serveur, jamais de l'adresse : celui de la Direction,
  // ou les mêmes catégories recalculées pour un gestionnaire / administrateur.
  const loisirs = loisirsScope ?? (await loisirsDemandeurIds(id));
  return <InscritsScreen id={id} sp={await searchParams} loisirs={loisirs} />;
}
