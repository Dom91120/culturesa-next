import { redirect } from "next/navigation";

// L'onglet « Paramètres » (/services/[id]) n'a pas de page propre : il redirige
// vers le premier sous-onglet. La navigation à sous-onglets (ParamsSubnav) est
// rendue par chaque sous-page. L'onglet reste surligné via le préfixe le plus
// long calculé dans ConnectedShell.
export default async function ServiceSettingsIndex({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/services/${id}/periodes`);
}
