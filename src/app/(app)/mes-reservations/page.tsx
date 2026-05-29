import Link from "next/link";
import { btnDanger, Card, PageTitle } from "@/components/ui";
import { listUserBookings } from "@/server/services/bookings";
import { requireUser } from "@/server/guards";
import { cancelBookingAction } from "./actions";

const dateFmt = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

export default async function MesReservationsPage() {
  const session = await requireUser();
  const bookings = await listUserBookings(session.user.id);

  return (
    <div className="space-y-6">
      <PageTitle>Mes réservations</PageTitle>

      <Card>
        {bookings.length === 0 ? (
          <p className="text-sm text-neutral-400">
            Vous n&apos;avez aucune réservation.{" "}
            <Link href="/reserver" className="text-brand-700 hover:underline">
              Réserver une activité
            </Link>
          </p>
        ) : (
          <div className="space-y-3">
            {bookings.map((b) => (
              <div
                key={b.id}
                className="flex items-center justify-between gap-4 rounded-md border border-neutral-100 p-4 dark:border-neutral-800"
              >
                <div>
                  <p className="font-medium">{b.service.label}</p>
                  <p className="text-sm text-neutral-500">
                    {b.slot.slotDate ? (
                      <span className="capitalize">{dateFmt.format(b.slot.slotDate)} · </span>
                    ) : null}
                    {b.slot.startTime} – {b.slot.endTime}
                  </p>
                  <span
                    className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                      b.validated
                        ? "bg-brand-50 text-brand-700"
                        : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                    }`}
                  >
                    {b.validated ? "Validée" : "En attente de validation"}
                  </span>
                </div>
                <form action={cancelBookingAction}>
                  <input type="hidden" name="id" value={b.id} />
                  <button type="submit" className={btnDanger}>
                    Annuler
                  </button>
                </form>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
