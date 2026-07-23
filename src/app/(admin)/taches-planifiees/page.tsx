import { redirect } from "next/navigation";

// Racine de l'onglet « Tâches planifiées » : redirige vers le premier sous-onglet.
export default function TachesPlanifieesPage() {
  redirect("/taches-planifiees/cron");
}
