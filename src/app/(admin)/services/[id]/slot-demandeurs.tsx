"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toggleSlotDemandeurAction } from "./slot-actions";

type Demandeur = { id: number; label: string };

export function SlotDemandeurs({
  slotId,
  serviceId,
  demandeurs,
  allowedIds,
}: {
  slotId: string;
  serviceId: string;
  demandeurs: Demandeur[];
  allowedIds: number[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const allowed = new Set(allowedIds);

  function toggle(demId: number, checked: boolean) {
    start(async () => {
      await toggleSlotDemandeurAction(slotId, serviceId, demId, checked);
      router.refresh();
    });
  }

  return (
    <div style={{ width: "100%", marginTop: ".5rem", display: "flex", flexWrap: "wrap", gap: ".6rem", alignItems: "center", opacity: pending ? 0.6 : 1 }}>
      <span style={{ fontSize: ".62rem", fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--muted)" }}>
        Réservé aux
      </span>
      {demandeurs.map((d) => (
        <label key={d.id} style={{ fontSize: ".72rem", display: "inline-flex", alignItems: "center", gap: ".25rem" }}>
          <input type="checkbox" checked={allowed.has(d.id)} disabled={pending} onChange={(e) => toggle(d.id, e.target.checked)} />
          {d.label}
        </label>
      ))}
      <span style={{ fontSize: ".66rem", color: "var(--muted)", fontStyle: "italic" }}>
        {allowed.size === 0 ? "(aucune coche = tous)" : ""}
      </span>
    </div>
  );
}
