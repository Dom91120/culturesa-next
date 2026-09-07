import { redirect } from "next/navigation";

// Racine de l'onglet « Utilisateurs » : redirige vers le premier sous-onglet (Comptes).
export default function UsersPage() {
  redirect("/users/comptes");
}
