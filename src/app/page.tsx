import { redirect } from "next/navigation";
import { getSession } from "@/server/guards";
import { listServicesForCurrentAdmin } from "@/server/services/services";

// Page d'accueil : aiguille selon le rôle. C'est aussi la cible du redirect
// post-connexion et du fallback requireRole(redirect("/")).
//   - administrateur → Administration (/configuration) ;
//   - gestionnaire   → l'agenda de son 1er service géré (sinon /mon-compte) ; il
//                      N'A PAS accès aux onglets d'administration ;
//   - direction des accueils de loisirs → idem, sur le 1er service qui en accueille ;
//   - tout autre compte / visiteur → la réservation.
export default async function HomePage() {
  const session = await getSession();
  const role = (session?.user as { role?: string } | undefined)?.role ?? "utilisateur";

  if (role === "administrateur") redirect("/configuration");
  if (role === "gestionnaire" || role === "direction_loisirs") {
    const services = await listServicesForCurrentAdmin();
    redirect(services.length > 0 ? `/services/${services[0].id}/agenda` : "/mon-compte");
  }
  redirect("/reservations");
}
