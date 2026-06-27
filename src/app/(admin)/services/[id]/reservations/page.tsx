import { redirect } from "next/navigation";

// L'onglet « Réservations » a été fusionné dans « Périodes et réservations » : son panneau
// est désormais rendu sous les périodes (cf. ../periodes/page.tsx). Cette route redirige
// vers /periodes pour ne pas casser les liens/marque-pages existants. Le composant
// ReservationsPanel reste dans ce dossier (importé par la page périodes).
export default async function ReservationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/services/${id}/periodes`);
}
