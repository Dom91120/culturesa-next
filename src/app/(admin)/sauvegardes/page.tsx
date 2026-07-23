import { redirect } from "next/navigation";

// L'onglet « Sauvegardes » est devenu le sous-onglet « Exports » de « Tâches planifiées » :
// cette route redirige pour ne pas casser les liens/marque-pages existants.
export default function SauvegardesPage() {
  redirect("/taches-planifiees/exports");
}
