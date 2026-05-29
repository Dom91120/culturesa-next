"use client";

import { useActionState } from "react";
import { initialActionState } from "@/lib/action-state";
import { btnPrimary, inputClass } from "@/components/ui";
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

export function ReserveSlot({ serviceId, slotId, dateLabel, timeLabel, remaining, capacity, mine }: Props) {
  const [state, action, pending] = useActionState(createBookingAction, initialActionState);
  const full = remaining <= 0;

  return (
    <div className="rounded-md border border-neutral-100 p-4 dark:border-neutral-800">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium capitalize">{dateLabel}</p>
          <p className="text-sm text-neutral-500">{timeLabel}</p>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
            full
              ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
              : "bg-brand-50 text-brand-700"
          }`}
        >
          {full ? "Complet" : `${remaining}/${capacity} places`}
        </span>
      </div>

      {mine ? (
        <p className="mt-3 text-sm font-medium text-brand-700">Vous êtes inscrit ✓</p>
      ) : (
        !full && (
          <form action={action} className="mt-3 flex flex-wrap items-end gap-3">
            <input type="hidden" name="slotId" value={slotId} />
            <input type="hidden" name="serviceId" value={serviceId} />
            <label className="text-xs">
              <span className="mb-1 block font-medium text-neutral-500">Enfants</span>
              <input name="enfants" type="number" min={0} defaultValue={0} className={`${inputClass} w-20`} />
            </label>
            <label className="text-xs">
              <span className="mb-1 block font-medium text-neutral-500">Accompagnants</span>
              <input name="accompagnants" type="number" min={0} defaultValue={0} className={`${inputClass} w-28`} />
            </label>
            <button type="submit" disabled={pending} className={btnPrimary}>
              {pending ? "Réservation…" : "Réserver"}
            </button>
          </form>
        )
      )}

      {state?.error && <p className="mt-2 text-sm text-red-600">{state.error}</p>}
    </div>
  );
}
