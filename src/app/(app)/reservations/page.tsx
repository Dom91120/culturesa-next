import { listBookableServices } from "@/server/services/bookings";
import { redirect } from "next/navigation";

// L'onglet « Réservations » est par service : on ouvre le premier service
// réservable par défaut (la sidebar permet d'en changer).
export default async function ReservationsIndexPage() {
  const services = await listBookableServices();
  if (services.length === 0) {
    return (
      <div className="panel">
        <p style={{ fontSize: ".85rem", color: "var(--muted)" }}>
          Aucune activité disponible pour le moment.
        </p>
      </div>
    );
  }
  redirect(`/reservations/${services[0].id}`);
}
