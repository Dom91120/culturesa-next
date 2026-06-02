"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import {
  deleteSlotsAction,
  saveRecurringSlotsAction,
  saveServiceSlotDefaultsAction,
  saveUniqueSlotsAction,
  setSlotDemandeursAction,
  setSlotsStateAction,
} from "./actions";
import { RecurringEditor } from "./recurring-editor";
import type { CreneauxData, EditRecurSlot, EditUniqueSlot, SaveResult } from "./shared";
import { stepDuration } from "./shared";
import { UniqueEditor } from "./unique-editor";

type Props = {
  serviceId: string;
  data: CreneauxData;
};

export function CreneauxPanel({ serviceId, data }: Props) {
  const router = useRouter();

  // Modes dérivés de la matrice demandeurs (ServiceDemandeurSettings), comme le legacy.
  const recurringMode = data.modes.recurringMode;
  const abMode = data.modes.abMode;

  // Sans demandeur récurrent, l'onglet « Créneaux récurrents » est masqué et
  // l'écran retombe sur les créneaux ponctuels (legacy : cren-tab-rec masqué).
  const [tab, setTab] = useState<"rec" | "uniq">(recurringMode ? "rec" : "uniq");
  const activeTab: "rec" | "uniq" = recurringMode ? tab : "uniq";

  // Service-level defaults (debounced persistence, like legacy scheduleDefaultsSave).
  const [recurDuration, setRecurDuration] = useState(data.service.recurDuration);
  const [ponctDuration, setPonctDuration] = useState(data.service.ponctDuration);
  const [ponctCapacity, setPonctCapacity] = useState(data.service.ponctCapacity);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function scheduleDefaultsSave(next: {
    recurDuration?: number;
    ponctDuration?: number;
    ponctCapacity?: number;
  }) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void saveServiceSlotDefaultsAction(serviceId, next);
    }, 600);
  }

  function refresh() {
    router.refresh();
  }

  // ── Wrapped server actions ────────────────────────────────────────
  async function saveRecurring(periodId: number, slots: EditRecurSlot[]): Promise<SaveResult> {
    return saveRecurringSlotsAction(
      serviceId,
      periodId,
      slots.map((s) => ({
        id: s.id.startsWith("new_") ? null : s.id,
        startTime: s.startTime,
        endTime: s.endTime,
        weeks: s.weeks,
        cap: s.cap,
        demandeurIds: s.demandeurIds,
      })),
    );
  }

  async function saveUnique(slots: EditUniqueSlot[]): Promise<SaveResult> {
    return saveUniqueSlotsAction(
      serviceId,
      slots.map((s) => ({
        id: s.id.startsWith("new_") ? null : s.id,
        parentSlotId: null,
        startTime: s.startTime,
        endTime: s.endTime,
        slotDate: s.slotDate || null,
        capacity: s.capacity,
      })),
    );
  }

  async function setSlotsState(ids: string[], state: string): Promise<SaveResult> {
    return setSlotsStateAction(serviceId, ids, state);
  }

  async function deleteSlots(ids: string[]): Promise<SaveResult> {
    return deleteSlotsAction(serviceId, ids);
  }

  async function setDemandeurs(slotId: string, ids: number[]): Promise<SaveResult> {
    return setSlotDemandeursAction(serviceId, slotId, ids);
  }

  return (
    <div>
      <nav
        style={{
          display: "flex",
          gap: 0,
          marginBottom: "-1px",
          justifyContent: "flex-end",
          padding: "0 1rem",
        }}
      >
        {recurringMode && (
          <button
            type="button"
            className={`cren-tab${activeTab === "rec" ? " active" : ""}`}
            onClick={() => setTab("rec")}
          >
            <span className="tab-icon">🔁</span> Créneaux récurrents
          </button>
        )}
        <button
          type="button"
          className={`cren-tab${activeTab === "uniq" ? " active" : ""}`}
          onClick={() => setTab("uniq")}
        >
          <span className="tab-icon">📌</span> Créneaux ponctuels
        </button>
      </nav>

      <div className={`cren-pane${activeTab === "rec" ? " active" : ""}`} id="pane-cren-rec">
        {activeTab === "rec" && (
          <RecurringEditor
            serviceId={serviceId}
            data={data}
            recurDuration={recurDuration}
            ponctCapacity={ponctCapacity}
            abMode={abMode}
            onDurationStep={(dir) => {
              const next = stepDuration(recurDuration, dir);
              setRecurDuration(next);
              scheduleDefaultsSave({ recurDuration: next });
            }}
            onCapacityChange={(v) => {
              setPonctCapacity(v);
              scheduleDefaultsSave({ ponctCapacity: v });
            }}
            saveRecurring={saveRecurring}
            setSlotsState={setSlotsState}
            deleteSlots={deleteSlots}
            setDemandeurs={setDemandeurs}
            refresh={refresh}
          />
        )}
      </div>

      <div className={`cren-pane${activeTab === "uniq" ? " active" : ""}`} id="pane-cren-uniq">
        {activeTab === "uniq" && (
          <UniqueEditor
            serviceId={serviceId}
            data={data}
            ponctDuration={ponctDuration}
            ponctCapacity={ponctCapacity}
            onDurationStep={(dir) => {
              const next = stepDuration(ponctDuration, dir);
              setPonctDuration(next);
              scheduleDefaultsSave({ ponctDuration: next });
            }}
            onCapacityChange={(v) => {
              setPonctCapacity(v);
              scheduleDefaultsSave({ ponctCapacity: v });
            }}
            saveUnique={saveUnique}
            deleteSlots={deleteSlots}
            setDemandeurs={setDemandeurs}
            refresh={refresh}
          />
        )}
      </div>
    </div>
  );
}
