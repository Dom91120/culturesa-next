import { getSession } from "@/server/guards";
import { redirect } from "next/navigation";

// Page d'accueil : aiguille selon le rôle. Un gestionnaire/administrateur arrive
// directement sur l'Administration (/configuration) ; tout autre compte (ou visiteur)
// sur la réservation. C'est aussi la cible du redirect post-connexion et du
// fallback requireRole(redirect("/")).
export default async function HomePage() {
  const session = await getSession();
  const role = (session?.user as { role?: string } | undefined)?.role ?? "utilisateur";
  const isManager = role === "gestionnaire" || role === "administrateur";
  redirect(isManager ? "/configuration" : "/reservations");
}
