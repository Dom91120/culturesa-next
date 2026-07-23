import { redirect } from "next/navigation";

// L'onglet « Sauvegardes » est devenu un sous-onglet de « Tâches planifiées » : cette
// route redirige pour ne pas casser les liens/marque-pages existants.
export default function SauvegardesPage() {
  redirect("/taches-planifiees/sauvegardes");
}
