import { redirect } from "next/navigation";

// L'onglet « Réservations » a été fusionné dans « Périodes et réservations » : le délai
// limite de réservation est désormais porté PAR EXERCICE et édité dans le sous-panel
// « Réservations » (cf. periodes/ + saveExerciceBookingDelayAction). Cette route redirige
// vers /periodes pour ne pas casser les liens/marque-pages existants.
export default async function ReservationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/services/${id}/periodes`);
}
