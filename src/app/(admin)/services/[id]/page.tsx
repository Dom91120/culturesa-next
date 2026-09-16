import { redirect } from "next/navigation";
import { requireServiceAccess } from "@/server/guards";

// L'onglet « Paramètres » (/services/[id]) n'a pas de page propre : il redirige
// vers le premier sous-onglet. La navigation à sous-onglets (ParamsSubnav) est
// rendue par chaque sous-page. L'onglet reste surligné via le préfixe le plus
// long calculé dans ConnectedShell. Un rattachement en consultation n'a pas de
// paramètres : il est renvoyé vers l'agenda.
export default async function ServiceSettingsIndex({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { readOnly } = await requireServiceAccess(id);
  redirect(`/services/${id}/${readOnly ? "agenda" : "periodes"}`);
}
