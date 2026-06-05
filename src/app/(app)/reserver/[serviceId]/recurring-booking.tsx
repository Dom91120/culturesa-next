"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { bookRecurringAction, cancelRecurringAction } from "./recurring-actions";

type Slot = {
  id: string;
  startTime: string;
  endTime: string;
  capacity: number | null;
  slotDay: string | null;
};
type Period = { id: number; label: string; color: string };
type Booking = {
  id: number;
  slotId: string;
  periodId: number;
  enfants: number;
  userId: string;
};

const DAY_NAMES: Record<string, string> = {
  lun: "Lundi",
  mar: "Mardi",
  mer: "Mercredi",
  jeu: "Jeudi",
  ven: "Vendredi",
  sam: "Samedi",
  dim: "Dimanche",
};

export function RecurringBooking({
  serviceId,
  days,
  defaultCapacity,
  slots,
  periods,
  bookings,
  userId,
  myEnfants,
}: {
  serviceId: string;
  days: string[];
  defaultCapacity: number;
  slots: Slot[];
  periods: Period[];
  bookings: Booking[];
  userId: string;
  myEnfants: number;
}) {
  const router = useRouter();
  const [periodIdx, setPeriodIdx] = useState(0);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const periodId = periods[periodIdx]?.id ?? null;

  function book(slotId: string) {
    if (periodId == null) return;
    setError(null);
    startTransition(async () => {
      const res = await bookRecurringAction(serviceId, slotId, periodId);
      if (!res.ok) setError(res.error ?? "Échec.");
      router.refresh();
    });
  }
  function cancel(bookingId: number) {
    setError(null);
    startTransition(async () => {
      await cancelRecurringAction(bookingId, serviceId);
      router.refresh();
    });
  }

  if (slots.length === 0 || periods.length === 0) {
    return (
      <p style={{ fontSize: ".82rem", color: "var(--muted)" }}>
        Aucun créneau récurrent ou aucune période active pour cette activité.
      </p>
    );
  }

  return (
    <div style={{ opacity: pending ? 0.6 : 1 }}>
      <div className="period-tabs">
        {periods.map((p, i) => (
          <button
            key={p.id}
            type="button"
            className={`period-btn ${i === periodIdx ? "active" : ""}`}
            style={{ "--period-color": p.color } as React.CSSProperties}
            onClick={() => setPeriodIdx(i)}
          >
            <span className="period-badge" />
            {p.label}
          </button>
        ))}
      </div>

      <div className="admin-table-wrap" style={{ marginTop: ".5rem" }}>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Créneau</th>
              {days.map((d) => (
                <th key={d} style={{ textAlign: "center" }}>
                  {DAY_NAMES[d] ?? d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slots.map((slot) => {
              const capacity = slot.capacity ?? defaultCapacity;
              return (
                <tr key={slot.id}>
                  <td style={{ whiteSpace: "nowrap", fontWeight: 600 }}>
                    {slot.startTime}–{slot.endTime}
                  </td>
                  {days.map((d) => {
                    // Modèle « un slot = un jour » : le créneau ne s'affiche que sur
                    // sa colonne (slotDay) ; les autres jours restent vides.
                    if (slot.slotDay !== d) {
                      return (
                        <td key={d} style={{ textAlign: "center", color: "var(--muted)" }}>
                          —
                        </td>
                      );
                    }
                    const cell = bookings.filter(
                      (b) => b.slotId === slot.id && b.periodId === periodId,
                    );
                    const used = cell.reduce((s, b) => s + b.enfants, 0);
                    const mine = cell.find((b) => b.userId === userId);
                    const remaining = capacity - used;
                    const canBook = !mine && remaining >= Math.max(1, myEnfants);
                    return (
                      <td key={d} style={{ textAlign: "center", padding: ".35rem" }}>
                        <div
                          style={{
                            fontSize: ".62rem",
                            color: remaining <= 0 ? "var(--danger)" : "var(--muted)",
                            marginBottom: 2,
                          }}
                        >
                          {used}/{capacity}
                        </div>
                        {mine ? (
                          <button
                            type="button"
                            className="btn btn-ghost"
                            style={{
                              fontSize: ".66rem",
                              padding: ".15rem .45rem",
                              borderColor: "rgba(224,107,107,.4)",
                              color: "var(--danger)",
                            }}
                            onClick={() => cancel(mine.id)}
                            disabled={pending}
                            title="Annuler ma réservation"
                          >
                            Inscrit ✓
                          </button>
                        ) : canBook ? (
                          <button
                            type="button"
                            className="btn btn-primary"
                            style={{ fontSize: ".66rem", padding: ".15rem .5rem" }}
                            onClick={() => book(slot.id)}
                            disabled={pending}
                          >
                            Réserver
                          </button>
                        ) : (
                          <span style={{ fontSize: ".66rem", color: "var(--muted)" }}>Complet</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {error && (
        <p className="field-error" style={{ display: "block", marginTop: ".4rem" }}>
          {error}
        </p>
      )}
      <p style={{ fontSize: ".68rem", color: "var(--muted)", marginTop: ".4rem" }}>
        Réservation pour {Math.max(1, myEnfants)} place{myEnfants > 1 ? "s" : ""} (selon votre
        profil). Cliquez sur « Inscrit ✓ » pour annuler.
      </p>
    </div>
  );
}
