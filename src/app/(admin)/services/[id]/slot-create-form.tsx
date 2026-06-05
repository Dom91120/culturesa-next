"use client";

import { btnPrimary, inputClass } from "@/components/ui";
import { initialActionState } from "@/lib/action-state";
import { useActionState } from "react";
import { createSlotAction } from "./slot-actions";

type Option = { id: number; label: string };

export function SlotCreateForm({
  serviceId,
  periods,
}: {
  serviceId: string;
  periods: Option[];
}) {
  const [state, action, pending] = useActionState(createSlotAction, initialActionState);

  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="serviceId" value={serviceId} />
      <label className="text-sm">
        <span className="mb-1 block font-medium">Type</span>
        <select name="slotType" defaultValue="recurring" className={inputClass}>
          <option value="recurring">Récurrent</option>
          <option value="unique">Ponctuel</option>
        </select>
      </label>
      <label className="text-sm">
        <span className="mb-1 block font-medium">Date (si ponctuel)</span>
        <input name="slotDate" type="date" className={inputClass} />
      </label>
      <label className="text-sm">
        <span className="mb-1 block font-medium">Jour (si récurrent)</span>
        <select name="slotDay" defaultValue="lun" className={inputClass}>
          <option value="lun">Lundi</option>
          <option value="mar">Mardi</option>
          <option value="mer">Mercredi</option>
          <option value="jeu">Jeudi</option>
          <option value="ven">Vendredi</option>
          <option value="sam">Samedi</option>
          <option value="dim">Dimanche</option>
        </select>
      </label>
      <label className="text-sm">
        <span className="mb-1 block font-medium">Début</span>
        <input name="startTime" type="time" defaultValue="09:00" required className={inputClass} />
      </label>
      <label className="text-sm">
        <span className="mb-1 block font-medium">Fin</span>
        <input name="endTime" type="time" defaultValue="10:30" required className={inputClass} />
      </label>
      <label className="text-sm">
        <span className="mb-1 block font-medium">Capacité</span>
        <input
          name="capacity"
          type="number"
          min={0}
          placeholder="défaut"
          className={`${inputClass} w-24`}
        />
      </label>
      <label className="text-sm">
        <span className="mb-1 block font-medium">Période</span>
        <select name="periodId" defaultValue="" className={inputClass}>
          <option value="">— aucune —</option>
          {periods.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <input type="hidden" name="state" value="actif" />
      <button type="submit" disabled={pending} className={btnPrimary}>
        {pending ? "Ajout…" : "Ajouter le créneau"}
      </button>
      {state?.error && <p className="w-full text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
