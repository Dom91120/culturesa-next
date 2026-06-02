import { redirect } from "next/navigation";

// Unifié dans l'onglet « Réservations » (agenda). Ancienne route conservée en
// redirection pour les liens/marque-pages existants.
export default function ReserverPage() {
  redirect("/reservations");
}
