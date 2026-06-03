"use client";

import { initialActionState } from "@/lib/action-state";
import { useActionState } from "react";
import { createBookingAction } from "./actions";

type Props = {
  serviceId: string;
  slotId: string;
  dateLabel: string;
  timeLabel: string;
  remaining: number;
  capacity: number;
  mine: boolean;
};

export function ReserveSlot({
  serviceId,
  slotId,
  dateLabel,
  timeLabel,
  remaining,
  capacity,
  mine,
}: Props) {
  const [state, action, pending] = useActionState(createBookingAction, initialActionState);
  const full = remaining <= 0;

  return (
    <div className="panel" style={{ padding: "1rem 1.1rem", marginBottom: ".6rem" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: ".75rem",
        }}
      >
        <div>
          <div style={{ fontWeight: 600, textTransform: "capitalize" }}>{dateLabel}</div>
          <div style={{ fontSize: ".8rem", color: "var(--muted)" }}>{timeLabel}</div>
        </div>
        <span
          className="role-pill"
          style={{
            background: full ? "var(--danger-dim)" : "var(--accent-dim)",
            color: full ? "var(--danger)" : "var(--accent)",
          }}
        >
          {full ? "Complet" : `${remaining}/${capacity} places`}
        </span>
      </div>

      {mine ? (
        <p
          style={{ marginTop: ".6rem", fontSize: ".8rem", fontWeight: 600, color: "var(--accent)" }}
        >
          Vous êtes inscrit ✓
        </p>
      ) : (
        !full && (
          <form
            action={action}
            style={{
              marginTop: ".6rem",
              display: "flex",
              flexWrap: "wrap",
              gap: ".6rem",
              alignItems: "flex-end",
            }}
          >
            <input type="hidden" name="slotId" value={slotId} />
            <input type="hidden" name="serviceId" value={serviceId} />
            <div className="field" style={{ width: 88 }}>
              <label htmlFor={`enf-${slotId}`}>Enfants</label>
              <input id={`enf-${slotId}`} name="enfants" type="number" min={0} defaultValue={0} />
            </div>
            <div className="field" style={{ width: 120 }}>
              <label htmlFor={`acc-${slotId}`}>Accompagnants</label>
              <input
                id={`acc-${slotId}`}
                name="accompagnants"
                type="number"
                min={0}
                defaultValue={0}
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? "Réservation…" : "Réserver"}
            </button>
          </form>
        )
      )}

      {state?.error && (
        <p className="field-error" style={{ display: "block", marginTop: ".4rem" }}>
          {state.error}
        </p>
      )}
    </div>
  );
}
