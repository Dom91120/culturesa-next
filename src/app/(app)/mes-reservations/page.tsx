import Link from "next/link";
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
    <div>
      <div className="panel-title">
        <span className="dot" />
        Mes réservations
      </div>

      {bookings.length === 0 ? (
        <div className="panel">
          <p style={{ fontSize: ".85rem", color: "var(--muted)" }}>
            Vous n&apos;avez aucune réservation.{" "}
            <Link href="/reserver" style={{ color: "var(--accent)", textDecoration: "underline" }}>
              Réserver une activité
            </Link>
          </p>
        </div>
      ) : (
        bookings.map((b) => (
          <div
            key={b.id}
            className="panel"
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", padding: "1rem 1.1rem", marginBottom: ".6rem" }}
          >
            <div>
              <div style={{ fontWeight: 600 }}>{b.service.label}</div>
              <div style={{ fontSize: ".8rem", color: "var(--muted)" }}>
                {b.slot.slotDate ? (
                  <span style={{ textTransform: "capitalize" }}>{dateFmt.format(b.slot.slotDate)} · </span>
                ) : null}
                {b.slot.startTime} – {b.slot.endTime}
              </div>
              <span
                className="role-pill"
                style={{
                  marginTop: ".35rem",
                  display: "inline-block",
                  background: b.validated ? "var(--accent-dim)" : "var(--warn-dim)",
                  color: b.validated ? "var(--accent)" : "var(--warn)",
                }}
              >
                {b.validated ? "Validée" : "En attente de validation"}
              </span>
            </div>
            <form action={cancelBookingAction}>
              <input type="hidden" name="id" value={b.id} />
              <button
                type="submit"
                className="btn btn-ghost"
                style={{ borderColor: "rgba(224,107,107,.4)", color: "var(--danger)" }}
              >
                Annuler
              </button>
            </form>
          </div>
        ))
      )}
    </div>
  );
}
