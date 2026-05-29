"use client";

import { useActionState } from "react";
import { initialActionState } from "@/lib/action-state";
import { btnPrimary, inputClass } from "@/components/ui";
import { DAYS } from "@/schemas/config";
import { updateServiceAction } from "../actions";

type ServiceFormData = {
  id: string;
  label: string;
  position: number;
  maxReservations: number;
  maxReservationsPeriod: number;
  activeDays: string;
  ponctDuration: number;
  ponctCapacity: number;
  recurDuration: number;
  recurCapacity: number;
  morningStart: string;
  morningEnd: string;
  afternoonStart: string;
  afternoonEnd: string;
  icon: string | null;
  bookingDelay: number;
  openOnHolidays: boolean;
  showPreviousExercices: boolean;
  themesMode: "libre" | "liste";
  autoValidationDelay: number;
};

const AUTO_VALIDATION = [
  { value: 0, label: "Jamais (validation manuelle)" },
  { value: -120, label: "2h ouvrées avant la séance" },
  { value: -1440, label: "1 jour ouvré avant" },
  { value: -2880, label: "2 jours ouvrés avant" },
  { value: -4320, label: "3 jours ouvrés avant" },
  { value: 10080, label: "1 semaine après la réservation" },
  { value: 20160, label: "2 semaines après la réservation" },
];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

export function ServiceForm({ service }: { service: ServiceFormData }) {
  const [state, action, pending] = useActionState(updateServiceAction, initialActionState);
  const active = new Set(service.activeDays.split(",").filter(Boolean));

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="id" value={service.id} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Libellé">
          <input name="label" defaultValue={service.label} required className={inputClass} />
        </Field>
        <Field label="Position">
          <input name="position" type="number" min={0} defaultValue={service.position} className={inputClass} />
        </Field>
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-medium">Jours d&apos;ouverture</legend>
        <div className="flex flex-wrap gap-3">
          {DAYS.map((d) => (
            <label key={d} className="flex items-center gap-1.5 text-sm capitalize">
              <input type="checkbox" name="activeDays" value={d} defaultChecked={active.has(d)} />
              {d}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Field label="Max résa / créneau">
          <input name="maxReservations" type="number" min={1} defaultValue={service.maxReservations} className={inputClass} />
        </Field>
        <Field label="Max résa / période">
          <input name="maxReservationsPeriod" type="number" min={1} defaultValue={service.maxReservationsPeriod} className={inputClass} />
        </Field>
        <Field label="Délai de réservation (j)">
          <input name="bookingDelay" type="number" min={0} defaultValue={service.bookingDelay} className={inputClass} />
        </Field>
        <Field label="Icône">
          <input name="icon" defaultValue={service.icon ?? ""} maxLength={16} className={inputClass} />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Field label="Durée ponctuel (min)">
          <input name="ponctDuration" type="number" min={1} defaultValue={service.ponctDuration} className={inputClass} />
        </Field>
        <Field label="Capacité ponctuel">
          <input name="ponctCapacity" type="number" min={1} defaultValue={service.ponctCapacity} className={inputClass} />
        </Field>
        <Field label="Durée récurrent (min)">
          <input name="recurDuration" type="number" min={1} defaultValue={service.recurDuration} className={inputClass} />
        </Field>
        <Field label="Capacité récurrent">
          <input name="recurCapacity" type="number" min={1} defaultValue={service.recurCapacity} className={inputClass} />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Field label="Matin — début">
          <input name="morningStart" type="time" defaultValue={service.morningStart} className={inputClass} />
        </Field>
        <Field label="Matin — fin">
          <input name="morningEnd" type="time" defaultValue={service.morningEnd} className={inputClass} />
        </Field>
        <Field label="Après-midi — début">
          <input name="afternoonStart" type="time" defaultValue={service.afternoonStart} className={inputClass} />
        </Field>
        <Field label="Après-midi — fin">
          <input name="afternoonEnd" type="time" defaultValue={service.afternoonEnd} className={inputClass} />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Mode des thèmes">
          <select name="themesMode" defaultValue={service.themesMode} className={inputClass}>
            <option value="libre">Libre (saisie)</option>
            <option value="liste">Liste prédéfinie</option>
          </select>
        </Field>
        <Field label="Auto-validation">
          <select name="autoValidationDelay" defaultValue={service.autoValidationDelay} className={inputClass}>
            {AUTO_VALIDATION.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="openOnHolidays" defaultChecked={service.openOnHolidays} />
          Ouvert les jours fériés
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="showPreviousExercices" defaultChecked={service.showPreviousExercices} />
          Afficher les exercices précédents
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={btnPrimary}>
          {pending ? "Enregistrement…" : "Enregistrer la configuration"}
        </button>
        {state?.ok && <span className="text-sm text-brand-700">Enregistré ✓</span>}
        {state?.error && <span className="text-sm text-red-600">{state.error}</span>}
      </div>
    </form>
  );
}
