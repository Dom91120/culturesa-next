"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DemandeursModal } from "./demandeurs-modal";
import { DurationStepper } from "./duration-stepper";
import {
  ALLDAY_DURATION,
  type CreneauxData,
  type EditUniqueSlot,
  SLOT_PAGE_SIZE,
  type SaveResult,
  activeDayKeys,
  addMinutes,
  isAllDay,
  isNewSlot,
  minToTime,
  newClientSlotId,
  nextSlotInRanges,
  nextWorkingDay,
} from "./shared";

type Props = {
  serviceId: string;
  data: CreneauxData;
  ponctDuration: number;
  ponctCapacity: number;
  onDurationStep: (dir: 1 | -1) => void;
  onCapacityChange: (v: number) => void;
  saveUnique: (slots: EditUniqueSlot[]) => Promise<SaveResult>;
  deleteSlots: (ids: string[]) => Promise<SaveResult>;
  setDemandeurs: (slotId: string, ids: number[]) => Promise<SaveResult>;
  refresh: () => void;
};

export function UniqueEditor({
  serviceId: _serviceId,
  data,
  ponctDuration,
  ponctCapacity,
  onDurationStep,
  onCapacityChange,
  saveUnique,
  deleteSlots,
  setDemandeurs,
  refresh,
}: Props) {
  // Pure manual unique slots (no parent).
  const initialSlots = useMemo<EditUniqueSlot[]>(
    () =>
      data.slots
        .filter((s) => s.slotType === "unique" && !s.parentSlotId && s.state === "actif")
        .sort((a, b) => {
          const d = (a.slotDate ?? "").localeCompare(b.slotDate ?? "");
          return d !== 0 ? d : a.startTime.localeCompare(b.startTime);
        })
        .map((s) => ({
          id: s.id,
          slotDate: s.slotDate ?? "",
          startTime: s.startTime,
          endTime: s.endTime,
          capacity: s.capacity ?? ponctCapacity,
          demandeurIds: [...s.demandeurIds],
        })),
    [data.slots, ponctCapacity],
  );

  const [slots, setSlots] = useState<EditUniqueSlot[]>(initialSlots);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [demModal, setDemModal] = useState<string | null>(null);

  const savedIds = useMemo(() => new Set(initialSlots.map((s) => s.id)), [initialSlots]);
  const dirty =
    slots.some((s) => isNewSlot(s.id)) ||
    JSON.stringify(slots) !== JSON.stringify(initialSlots) ||
    selected.size > 0;

  const totalPages = Math.max(1, Math.ceil(slots.length / SLOT_PAGE_SIZE));
  const pageClamped = Math.min(page, totalPages - 1);
  const pageSlots = slots.slice(pageClamped * SLOT_PAGE_SIZE, (pageClamped + 1) * SLOT_PAGE_SIZE);

  function update(id: string, patch: Partial<EditUniqueSlot>) {
    setSlots((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        const next = { ...s, ...patch };
        // Pas de dérivation de la fin en « journée entière » (début vide / durée 1 jour).
        if (patch.startTime && ponctDuration < ALLDAY_DURATION) {
          next.endTime = addMinutes(patch.startTime, ponctDuration);
        }
        return next;
      }),
    );
  }

  // ── Flèches ▲/▼ de réglage de l'heure de début (port du legacy timeStep) ──
  // ±15 min, bornées sur 24h (wrap), avec clic-maintenu : 1er tick immédiat puis
  // répétition après 400 ms toutes les 80 ms. La fin suit (start + durée) via update().
  const holdRef = useRef<{
    timeout?: ReturnType<typeof setTimeout>;
    interval?: ReturnType<typeof setInterval>;
  }>({});
  function stopHold() {
    if (holdRef.current.timeout) clearTimeout(holdRef.current.timeout);
    if (holdRef.current.interval) clearInterval(holdRef.current.interval);
    holdRef.current = {};
  }
  // Filet de sécurité : un relâchement souris/tactile hors bouton stoppe la répétition.
  // biome-ignore lint/correctness/useExhaustiveDependencies: stopHold ne touche que holdRef (stable) — écouteurs liés au montage
  useEffect(() => {
    window.addEventListener("mouseup", stopHold);
    window.addEventListener("touchend", stopHold);
    window.addEventListener("touchcancel", stopHold);
    return () => {
      window.removeEventListener("mouseup", stopHold);
      window.removeEventListener("touchend", stopHold);
      window.removeEventListener("touchcancel", stopHold);
      stopHold();
    };
  }, []);
  function stepStart(id: string, delta: number) {
    if (ponctDuration >= ALLDAY_DURATION) return; // « journée entière » : pas d'heure
    setSlots((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        const m = (s.startTime || "09:00")
          .trim()
          .replace("h", ":")
          .match(/^(\d{1,2}):(\d{1,2})$/);
        let total = m ? Number.parseInt(m[1], 10) * 60 + Number.parseInt(m[2], 10) : 9 * 60;
        total = (((total + delta) % 1440) + 1440) % 1440; // wrap [0..1439]
        const start = `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
        return { ...s, startTime: start, endTime: addMinutes(start, ponctDuration) };
      }),
    );
  }
  function startStepHold(id: string, delta: number, ev: React.MouseEvent | React.TouchEvent) {
    ev.preventDefault();
    stopHold();
    stepStart(id, delta);
    holdRef.current.timeout = setTimeout(() => {
      holdRef.current.interval = setInterval(() => stepStart(id, delta), 80);
    }, 400);
  }

  // Passe une ligne en « journée entière » (efface début + fin, cf. legacy 🚫).
  function setAllDay(id: string) {
    update(id, { startTime: "", endTime: "" });
  }

  // Redonne des horaires à une ligne « journée entière » (cf. legacy ➕).
  function initTimes(id: string) {
    const dur = ponctDuration < ALLDAY_DURATION ? ponctDuration : 60;
    update(id, { startTime: "09:00", endTime: addMinutes("09:00", dur) });
  }

  function addSlot() {
    let lastDate = "";
    for (const s of slots) if (s.slotDate && s.slotDate > lastDate) lastDate = s.slotDate;
    const firstPeriod = data.periods[0];
    let targetDate = lastDate || firstPeriod?.startDate || "";
    const activeDays = activeDayKeys(data.service);
    // Plages d'ouverture réelles du service (port legacy nextSlotForDate).
    const ranges: [string, string][] = [
      [data.service.morningStart, data.service.morningEnd],
      [data.service.afternoonStart, data.service.afternoonEnd],
    ];
    // Durée = 1 jour → créneau ponctuel « journée entière » : sans horaire.
    const allday = ponctDuration >= ALLDAY_DURATION;
    let start = "";
    if (allday) {
      // Journée entière : on avance au jour ouvré suivant si une date existe déjà.
      if (lastDate) targetDate = nextWorkingDay(lastDate, activeDays);
    } else if (lastDate) {
      // Place dans les plages de la date courante ; si pleine, jour ouvré suivant
      // (port legacy addSlotUniq). En dernier recours : ouverture du matin.
      const freeStartOn = () =>
        nextSlotInRanges(
          slots
            .filter((s) => s.slotDate === targetDate)
            .map((s) => ({ startTime: s.startTime, endTime: s.endTime })),
          ponctDuration,
          ranges,
        );
      let m = freeStartOn();
      if (m == null) {
        targetDate = nextWorkingDay(targetDate, activeDays);
        m = freeStartOn();
      }
      start = m != null ? minToTime(m) : data.service.morningStart || "09:00";
    } else {
      // Première date : début = ouverture du matin (cf. legacy morningStart).
      start = data.service.morningStart || "09:00";
    }
    const id = newClientSlotId();
    setSlots((prev) => [
      ...prev,
      {
        id,
        slotDate: targetDate,
        startTime: start,
        endTime: start ? addMinutes(start, ponctDuration) : "",
        capacity: ponctCapacity,
        demandeurIds: [],
      },
    ]);
    setSelected((prev) => new Set(prev).add(id));
    setPage(Math.floor(slots.length / SLOT_PAGE_SIZE));
  }

  function toggle(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function deleteSelected() {
    if (selected.size === 0) return;
    if (!window.confirm(`Supprimer ${selected.size} créneau(x) ponctuel(s) ?`)) return;
    const ids = [...selected];
    const persisted = ids.filter((id) => savedIds.has(id));
    setSlots((prev) => prev.filter((s) => !selected.has(s.id)));
    setSelected(new Set());
    if (persisted.length) {
      setSaving(true);
      const res = await deleteSlots(persisted);
      setSaving(false);
      if (!res.ok) {
        setError(res.error ?? "Échec de la suppression.");
        return;
      }
      refresh();
    }
  }

  function cancel() {
    setSlots(initialSlots);
    setSelected(new Set());
    setError(null);
  }

  async function save() {
    setSaving(true);
    setError(null);
    const res = await saveUnique(slots);
    setSaving(false);
    if (!res.ok) {
      setError(res.error ?? "Échec de l'enregistrement.");
      return;
    }
    setSelected(new Set());
    refresh();
  }

  const anyReservedSelected = [...selected].some((id) => {
    const sl = data.slots.find((s) => s.id === id);
    return sl ? sl.bookingCount > 0 : false;
  });

  return (
    <div>
      <div className="panel-title">
        <span className="dot" style={{ background: "var(--warn)" }} />
        Créneaux ponctuels
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "2rem",
          marginBottom: ".75rem",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: ".4rem" }}>
          <span className="cap-tool-label">Durée</span>
          <DurationStepper value={ponctDuration} onStep={onDurationStep} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: ".4rem" }}>
          <span className="cap-tool-label">Capacité</span>
          <input
            type="number"
            min={1}
            max={999}
            value={ponctCapacity}
            className="cap-input"
            onChange={(e) =>
              onCapacityChange(Math.max(1, Number.parseInt(e.target.value, 10) || 1))
            }
          />
        </div>
        <button type="button" className="btn btn-ghost btn-add-slot" onClick={addSlot}>
          ＋ Ajouter
        </button>
      </div>

      <div className="planning-wrap">
        <table className="admin-table cap-editor-table">
          <thead>
            <tr>
              <th className="col-check" style={{ width: 32 }} />
              <th style={{ width: 130, textAlign: "center" }}>Date</th>
              <th style={{ width: 80, textAlign: "center" }}>Début</th>
              <th style={{ width: 80, textAlign: "center" }}>Fin</th>
              <th style={{ width: 80, textAlign: "center" }}>Capacité</th>
              <th style={{ width: 36, textAlign: "center" }} title="Demandeurs autorisés">
                👥
              </th>
            </tr>
          </thead>
          <tbody>
            {pageSlots.map((sl) => {
              const checked = selected.has(sl.id);
              const isExisting = savedIds.has(sl.id);
              const dbSlot = data.slots.find((s) => s.id === sl.id);
              const reserved = isExisting && (dbSlot?.bookingCount ?? 0) > 0;
              const disTime = (isExisting && !checked) || reserved;
              const minC = Math.max(1, dbSlot?.bookingCount ?? 0);
              return (
                <tr key={sl.id}>
                  <td className="col-check">
                    <input
                      type="checkbox"
                      className="admin-cb"
                      checked={checked}
                      onChange={(e) => toggle(sl.id, e.target.checked)}
                    />
                  </td>
                  <td style={{ textAlign: "center" }}>
                    <input
                      type="date"
                      value={sl.slotDate}
                      disabled={disTime}
                      onChange={(e) => update(sl.id, { slotDate: e.target.value })}
                      style={{ fontSize: ".78rem" }}
                    />
                  </td>
                  {isAllDay(sl.startTime, sl.endTime) ? (
                    <td colSpan={2} style={{ textAlign: "center" }}>
                      <span
                        style={{ color: "var(--muted)", fontSize: ".72rem", fontStyle: "italic" }}
                        title="Créneau sans horaire (journée complète)"
                      >
                        Journée entière
                      </span>
                      {!disTime && (
                        <button
                          type="button"
                          className="cell-add-btn"
                          title="Définir une heure de début et de fin"
                          onClick={() => initTimes(sl.id)}
                          style={{
                            marginLeft: ".4rem",
                            border: "none",
                            background: "none",
                            cursor: "pointer",
                          }}
                        >
                          ➕
                        </button>
                      )}
                    </td>
                  ) : (
                    <>
                      <td style={{ textAlign: "center" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
                          <input
                            type="text"
                            value={sl.startTime}
                            disabled={disTime}
                            onChange={(e) =>
                              update(sl.id, { startTime: e.target.value.replace("h", ":") })
                            }
                            style={{ width: 58, fontSize: ".78rem", textAlign: "center" }}
                          />
                          {/* Flèches ±15 min (port legacy _timeStepBtns). */}
                          <span className="time-step-btns">
                            <button
                              type="button"
                              className="time-step-btn"
                              tabIndex={-1}
                              disabled={disTime}
                              onMouseDown={(e) => startStepHold(sl.id, 15, e)}
                              onTouchStart={(e) => startStepHold(sl.id, 15, e)}
                              onMouseLeave={stopHold}
                            >
                              ▲
                            </button>
                            <button
                              type="button"
                              className="time-step-btn"
                              tabIndex={-1}
                              disabled={disTime}
                              onMouseDown={(e) => startStepHold(sl.id, -15, e)}
                              onTouchStart={(e) => startStepHold(sl.id, -15, e)}
                              onMouseLeave={stopHold}
                            >
                              ▼
                            </button>
                          </span>
                          {!disTime && (
                            <button
                              type="button"
                              className="cell-clear-btn"
                              title="Passer en journée entière (sans horaire)"
                              onClick={() => setAllDay(sl.id)}
                              style={{ border: "none", background: "none", cursor: "pointer" }}
                            >
                              🚫
                            </button>
                          )}
                        </span>
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <input
                          type="text"
                          value={sl.endTime}
                          readOnly
                          style={{
                            width: 58,
                            fontSize: ".78rem",
                            textAlign: "center",
                            color: "var(--muted)",
                            pointerEvents: "none",
                          }}
                        />
                      </td>
                    </>
                  )}
                  <td style={{ textAlign: "center" }}>
                    <input
                      type="number"
                      min={minC}
                      max={99}
                      value={sl.capacity}
                      disabled={isExisting && !checked}
                      onChange={(e) =>
                        update(sl.id, {
                          capacity: Math.max(minC, Number.parseInt(e.target.value, 10) || 1),
                        })
                      }
                      style={{ width: 52, fontSize: ".78rem", textAlign: "center" }}
                    />
                  </td>
                  <td style={{ textAlign: "center" }}>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => setDemModal(sl.id)}
                      title={
                        sl.demandeurIds.length
                          ? `${sl.demandeurIds.length} demandeur(s) autorisé(s)`
                          : "Aucune restriction"
                      }
                      style={{
                        padding: "1px 5px",
                        fontSize: ".78rem",
                        ...(sl.demandeurIds.length
                          ? { borderColor: "var(--accent)", color: "var(--accent)" }
                          : { color: "var(--muted)" }),
                      }}
                    >
                      👥
                    </button>
                  </td>
                </tr>
              );
            })}
            {slots.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  style={{ textAlign: "center", color: "var(--muted)", padding: ".6rem" }}
                >
                  Aucun créneau ponctuel.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div
        style={{
          marginTop: ".75rem",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: ".75rem",
        }}
      >
        <div
          style={{
            visibility: selected.size ? "visible" : "hidden",
            display: "flex",
            alignItems: "center",
            gap: ".75rem",
          }}
        >
          <span style={{ fontSize: ".82rem", color: "var(--muted)" }}>
            {selected.size} sélectionné(s)
          </span>
          {!anyReservedSelected && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={deleteSelected}
              style={{
                borderColor: "rgba(220,80,80,.4)",
                color: "#e05555",
                fontSize: ".7rem",
                padding: ".2rem .6rem",
              }}
            >
              Supprimer
            </button>
          )}
        </div>
        <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
          {totalPages > 1 && (
            <div
              style={{ display: "flex", alignItems: "center", gap: ".5rem", fontSize: ".82rem" }}
            >
              <button
                type="button"
                className="btn btn-ghost"
                style={{ padding: "2px 8px" }}
                disabled={pageClamped === 0}
                onClick={() => setPage(pageClamped - 1)}
              >
                ‹
              </button>
              <span style={{ color: "var(--muted)" }}>
                Page {pageClamped + 1} / {totalPages}
              </span>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ padding: "2px 8px" }}
                disabled={pageClamped >= totalPages - 1}
                onClick={() => setPage(pageClamped + 1)}
              >
                ›
              </button>
            </div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
          {error && (
            <span className="field-error" style={{ display: "inline" }}>
              {error}
            </span>
          )}
          {dirty && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={cancel}
              style={{ fontSize: ".7rem", padding: ".2rem .6rem" }}
            >
              Annuler
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary"
            onClick={save}
            disabled={saving}
            style={{
              background: "var(--warn)",
              color: "#0f1117",
              fontSize: ".7rem",
              padding: ".2rem .6rem",
            }}
          >
            {saving ? "Enregistrement…" : "💾 Enregistrer"}
          </button>
        </div>
      </div>

      {demModal && (
        <DemandeursModal
          demandeurs={data.demandeurs}
          selected={slots.find((s) => s.id === demModal)?.demandeurIds ?? []}
          saving={saving}
          onClose={() => setDemModal(null)}
          onSave={async (ids) => {
            const id = demModal;
            // Update local state immediately.
            update(id, { demandeurIds: ids });
            setDemModal(null);
            // Persist directly if the slot already exists server-side.
            if (savedIds.has(id) && !isNewSlot(id)) {
              const res = await setDemandeurs(id, ids);
              if (!res.ok) setError(res.error ?? "Échec.");
              else refresh();
            }
          }}
        />
      )}
    </div>
  );
}
