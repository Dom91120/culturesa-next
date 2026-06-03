"use client";

import { useMemo, useState } from "react";
import { DemandeursModal } from "./demandeurs-modal";
import { DurationStepper } from "./duration-stepper";
import { MirrorEditor } from "./mirror-editor";
import {
  ALLDAY_DURATION,
  type CreneauxData,
  DAY_CAP_FIELD,
  DAY_KEYS,
  DAY_LABELS,
  type DayKey,
  type EditRecurSlot,
  SLOT_PAGE_SIZE,
  type SaveResult,
  activeDayKeys,
  addMinutes,
  isAllDay,
  minToTime,
  newClientSlotId,
  nextSlotInRanges,
  parseWeeks,
  stepDuration,
} from "./shared";

type Props = {
  serviceId: string;
  data: CreneauxData;
  recurDuration: number;
  ponctCapacity: number;
  abMode: boolean;
  onDurationStep: (dir: 1 | -1) => void;
  onCapacityChange: (v: number) => void;
  saveRecurring: (periodId: number, slots: EditRecurSlot[]) => Promise<SaveResult>;
  setSlotsState: (ids: string[], state: string) => Promise<SaveResult>;
  deleteSlots: (ids: string[]) => Promise<SaveResult>;
  setDemandeurs: (slotId: string, ids: number[]) => Promise<SaveResult>;
  refresh: () => void;
};

function weekLabel(weeks: string): string {
  const list = parseWeeks(weeks);
  return list.length > 1 ? `Semaines ${list.join(" & ")}` : `Semaine ${list[0]}`;
}

export function RecurringEditor({
  serviceId: _serviceId,
  data,
  recurDuration,
  ponctCapacity,
  abMode,
  onDurationStep,
  onCapacityChange,
  saveRecurring,
  setSlotsState,
  deleteSlots,
  setDemandeurs,
  refresh,
}: Props) {
  const activeDays = useMemo(() => activeDayKeys(data.service), [data.service]);
  const dayCols = DAY_KEYS.filter((d) => activeDays.includes(d));

  const [periodIdx, setPeriodIdx] = useState(0);
  const period = data.periods[periodIdx] ?? null;

  // Day filter for "Ajouter" (defaults: all active days checked).
  const [filterDays, setFilterDays] = useState<Set<DayKey>>(new Set(activeDays));

  // Recurring slots for the selected period, mapped to the edit buffer.
  const initialSlots = useMemo<EditRecurSlot[]>(() => {
    if (!period) return [];
    return data.slots
      .filter((s) => s.slotType === "recurring" && s.periodId === period.id && s.state === "actif")
      .sort((a, b) => a.startTime.localeCompare(b.startTime))
      .map((s) => {
        const cap: Partial<Record<DayKey, number | null>> = {};
        for (const d of DAY_KEYS) {
          const v = s[DAY_CAP_FIELD[d]] as number | null;
          if (v != null) cap[d] = v;
        }
        return {
          id: s.id,
          startTime: s.startTime,
          endTime: s.endTime,
          weeks: s.weeks ?? "A,B",
          cap,
          demandeurIds: [...s.demandeurIds],
        };
      });
  }, [data.slots, period]);

  const [slots, setSlots] = useState<EditRecurSlot[]>(initialSlots);
  const [bufferPeriodId, setBufferPeriodId] = useState<number | null>(period?.id ?? null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Message informatif (non bloquant) : ex. plus de place dans les plages horaires.
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [demModal, setDemModal] = useState<string | null>(null);

  // Re-initialise the buffer when the active period changes.
  if (period && bufferPeriodId !== period.id) {
    setBufferPeriodId(period.id);
    setSlots(initialSlots);
    setSelected(new Set());
    setPage(0);
  }

  const savedIds = useMemo(() => new Set(initialSlots.map((s) => s.id)), [initialSlots]);
  const dirty =
    selected.size > 0 ||
    slots.some((s) => !savedIds.has(s.id)) ||
    JSON.stringify(slots) !== JSON.stringify(initialSlots);

  const totalPages = Math.max(1, Math.ceil(slots.length / SLOT_PAGE_SIZE));
  const pageClamped = Math.min(page, totalPages - 1);
  const pageSlots = slots.slice(pageClamped * SLOT_PAGE_SIZE, (pageClamped + 1) * SLOT_PAGE_SIZE);

  function reserved(id: string): boolean {
    const sl = data.slots.find((s) => s.id === id);
    return sl ? sl.bookingCount > 0 : false;
  }

  function update(id: string, patch: Partial<EditRecurSlot>) {
    setSlots((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        const next = { ...s, ...patch };
        // Dérive la fin depuis le début SAUF en « journée entière » (début vide,
        // ou durée = 1 jour) : on ne touche alors pas aux heures.
        if (patch.startTime && recurDuration < ALLDAY_DURATION) {
          next.endTime = addMinutes(patch.startTime, recurDuration);
        }
        return next;
      }),
    );
  }

  // Passe une ligne en « journée entière » (efface début + fin, cf. legacy 🚫).
  function setAllDay(id: string) {
    update(id, { startTime: "", endTime: "" });
  }

  // Redonne des horaires à une ligne « journée entière » (cf. legacy ➕ _slotInitTimes).
  function initTimes(id: string) {
    const dur = recurDuration < ALLDAY_DURATION ? recurDuration : 60;
    update(id, { startTime: "09:00", endTime: addMinutes("09:00", dur) });
  }

  function setCap(id: string, day: DayKey, value: number | null) {
    setSlots((prev) =>
      prev.map((s) => (s.id === id ? { ...s, cap: { ...s.cap, [day]: value } } : s)),
    );
  }

  function removeCap(id: string, day: DayKey) {
    setSlots((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        const cap = { ...s.cap };
        delete cap[day];
        return { ...s, cap };
      }),
    );
  }

  function addSlot() {
    const cap: Partial<Record<DayKey, number | null>> = {};
    for (const d of dayCols) if (filterDays.has(d)) cap[d] = ponctCapacity;
    const id = newClientSlotId();
    // Durée = 1 jour → créneau « journée entière » : pas d'horaire (début/fin vides).
    const allday = recurDuration >= ALLDAY_DURATION;
    let start = "";
    setNotice(null);
    if (!allday) {
      // Placement automatique dans les VRAIES plages d'ouverture du service
      // (matin / après-midi), juste après le dernier créneau (port legacy).
      const ranges: [string, string][] = [
        [data.service.morningStart, data.service.morningEnd],
        [data.service.afternoonStart, data.service.afternoonEnd],
      ];
      const startMin = nextSlotInRanges(
        slots.map((s) => ({ startTime: s.startTime, endTime: s.endTime })),
        recurDuration,
        ranges,
      );
      if (startMin == null) {
        // Plus de place dans les plages → créneau « journée entière » à ajuster
        // manuellement (cf. legacy : toast + slot sans horaire).
        setNotice(
          "Plus de place dans les plages horaires — créneau « journée entière » ajouté, ajustez les horaires.",
        );
      } else {
        start = minToTime(startMin);
      }
    }
    setSlots((prev) => [
      ...prev,
      {
        id,
        startTime: start,
        endTime: start ? addMinutes(start, recurDuration) : "",
        weeks: "A,B",
        cap,
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
    if ([...selected].some((id) => reserved(id))) return;
    if (!window.confirm(`Supprimer ${selected.size} créneau(x) récurrent(s) ?`)) return;
    const ids = [...selected];
    // Nouveaux créneaux (jamais enregistrés) : simple retrait du buffer.
    // Existants : suppression immédiate en base (+ miroirs/réservations), comme le legacy.
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
    setNotice(null);
  }

  async function save() {
    if (!period) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    const res = await saveRecurring(period.id, slots);
    setSaving(false);
    if (!res.ok) {
      setError(res.error ?? "Échec de l'enregistrement.");
      return;
    }
    setSelected(new Set());
    refresh();
  }

  function applyCapToAll() {
    const capVal = Math.max(1, ponctCapacity);
    if (slots.length === 0) return;
    if (
      !window.confirm(
        `Cette action va remplacer la capacité de tous les créneaux récurrents par « ${capVal} ».`,
      )
    ) {
      return;
    }
    setSlots((prev) =>
      prev.map((s) => {
        const cap: Partial<Record<DayKey, number | null>> = {};
        for (const d of Object.keys(s.cap) as DayKey[]) cap[d] = capVal;
        return { ...s, cap };
      }),
    );
  }

  const anyReservedSelected = [...selected].some((id) => reserved(id));
  // Mirror sub-section visible when at least one recurring slot is selected.
  const selectedRecurForMirrors = [...selected].filter((id) => savedIds.has(id));

  return (
    <div>
      <div id="section-creneaux-recurrents">
        <div className="panel-title">
          <span className="dot" style={{ background: "var(--warn)" }} />
          Créneaux récurrents
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "2rem",
            flexWrap: "wrap",
            marginBottom: ".75rem",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: ".4rem" }}>
            <span className="cap-tool-label">Durée</span>
            <DurationStepper value={recurDuration} onStep={onDurationStep} />
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
            <button
              type="button"
              className="btn btn-ghost"
              onClick={applyCapToAll}
              title="Appliquer cette capacité à tous les créneaux"
              style={{
                borderColor: "rgba(220,160,60,.5)",
                color: "var(--warn)",
                padding: ".15rem .5rem",
              }}
            >
              ⚡
            </button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: ".5rem", flexWrap: "wrap" }}>
            {dayCols.map((d) => (
              <label
                key={d}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: ".25rem",
                  fontSize: ".68rem",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  className="admin-cb"
                  checked={filterDays.has(d)}
                  onChange={(e) =>
                    setFilterDays((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(d);
                      else next.delete(d);
                      return next;
                    })
                  }
                  style={{ accentColor: "var(--accent)", width: 11, height: 11 }}
                />
                {DAY_LABELS[d]}
              </label>
            ))}
          </div>
          <button type="button" className="btn btn-ghost btn-add-slot" onClick={addSlot}>
            ＋ Ajouter
          </button>
        </div>

        <div className="period-tabs" id="cap-period-tabs-2">
          {data.periods.map((p, i) => (
            <button
              key={p.id}
              type="button"
              className={`period-btn${i === periodIdx ? " active" : ""}`}
              onClick={() => setPeriodIdx(i)}
            >
              <span className="period-badge" />
              {p.name}
            </button>
          ))}
        </div>

        <div id="cap-editor-2">
          {!period ? (
            <p style={{ color: "var(--muted)", fontSize: ".85rem", margin: ".5rem 0" }}>
              Aucune période active. Créez une période dans l&apos;onglet Paramètres.
            </p>
          ) : (
            <div className="planning-wrap">
              <table className="admin-table cap-editor-table">
                <thead>
                  <tr>
                    <th className="col-check" style={{ width: 32 }} />
                    {abMode && <th style={{ width: 110, textAlign: "center" }}>Semaine</th>}
                    <th style={{ width: 70, textAlign: "center" }}>Début</th>
                    <th style={{ width: 70, textAlign: "center" }}>Fin</th>
                    {dayCols.map((d) => (
                      <th key={d} style={{ textAlign: "center" }}>
                        {DAY_LABELS[d]}
                      </th>
                    ))}
                    <th style={{ width: 36, textAlign: "center" }} title="Demandeurs autorisés">
                      👥
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pageSlots.map((sl) => {
                    const checked = selected.has(sl.id);
                    const isReserved = reserved(sl.id);
                    const disTime = !checked || isReserved;
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
                        {abMode &&
                          (checked ? (
                            <td style={{ textAlign: "center" }}>
                              <select
                                value={sl.weeks}
                                onChange={(e) => update(sl.id, { weeks: e.target.value })}
                                style={{ fontSize: ".72rem", padding: "1px 3px" }}
                              >
                                <option value="A,B">Semaines A &amp; B</option>
                                <option value="A">Semaine A</option>
                                <option value="B">Semaine B</option>
                              </select>
                            </td>
                          ) : (
                            <td style={{ textAlign: "center", fontSize: ".7rem", fontWeight: 700 }}>
                              {weekLabel(sl.weeks)}
                            </td>
                          ))}
                        {isAllDay(sl.startTime, sl.endTime) ? (
                          <td colSpan={2} style={{ textAlign: "center" }}>
                            <span
                              style={{
                                color: "var(--muted)",
                                fontSize: ".72rem",
                                fontStyle: "italic",
                              }}
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
                            <td>
                              <span
                                style={{ display: "inline-flex", alignItems: "center", gap: 2 }}
                              >
                                <input
                                  type="text"
                                  value={sl.startTime}
                                  disabled={disTime}
                                  onChange={(e) =>
                                    update(sl.id, { startTime: e.target.value.replace("h", ":") })
                                  }
                                  placeholder="09:30"
                                  style={{ width: 58, fontSize: ".78rem", textAlign: "center" }}
                                />
                                {!disTime && (
                                  <button
                                    type="button"
                                    className="cell-clear-btn"
                                    title="Passer en journée entière (sans horaire)"
                                    onClick={() => setAllDay(sl.id)}
                                    style={{
                                      border: "none",
                                      background: "none",
                                      cursor: "pointer",
                                    }}
                                  >
                                    🚫
                                  </button>
                                )}
                              </span>
                            </td>
                            <td>
                              <input
                                type="text"
                                value={sl.endTime}
                                readOnly
                                style={{
                                  width: 58,
                                  fontSize: ".78rem",
                                  color: "var(--muted)",
                                  pointerEvents: "none",
                                }}
                              />
                            </td>
                          </>
                        )}
                        {dayCols.map((d) => {
                          const has = d in sl.cap && sl.cap[d] != null;
                          const minC = 0;
                          if (has) {
                            return (
                              <td key={d} style={{ textAlign: "center" }}>
                                <span
                                  style={{ display: "inline-flex", alignItems: "center", gap: 2 }}
                                >
                                  <input
                                    type="number"
                                    min={minC}
                                    max={99}
                                    value={sl.cap[d] ?? 0}
                                    disabled={!checked}
                                    onChange={(e) =>
                                      setCap(
                                        sl.id,
                                        d,
                                        Math.max(minC, Number.parseInt(e.target.value, 10) || 0),
                                      )
                                    }
                                    style={{ width: 52, textAlign: "center", fontSize: ".78rem" }}
                                  />
                                  {checked && !isReserved && (
                                    <button
                                      type="button"
                                      className="cell-clear-btn"
                                      title="Retirer ce jour"
                                      onClick={() => removeCap(sl.id, d)}
                                      style={{
                                        border: "none",
                                        background: "none",
                                        cursor: "pointer",
                                      }}
                                    >
                                      🚫
                                    </button>
                                  )}
                                </span>
                              </td>
                            );
                          }
                          return (
                            <td key={d} style={{ textAlign: "center" }}>
                              {checked ? (
                                <button
                                  type="button"
                                  className="cell-add-btn"
                                  title="Activer ce jour"
                                  onClick={() => setCap(sl.id, d, ponctCapacity)}
                                  style={{ border: "none", background: "none", cursor: "pointer" }}
                                >
                                  ➕
                                </button>
                              ) : (
                                <span style={{ color: "var(--muted)", fontSize: ".75rem" }}>—</span>
                              )}
                            </td>
                          );
                        })}
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
                        colSpan={3 + (abMode ? 1 : 0) + dayCols.length + 1}
                        style={{ textAlign: "center", color: "var(--muted)", padding: ".6rem" }}
                      >
                        Aucun créneau récurrent pour cette période.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
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
            {notice && !error && (
              <span style={{ fontSize: ".7rem", color: "var(--muted)" }}>{notice}</span>
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
      </div>

      {selectedRecurForMirrors.length > 0 && period && (
        <MirrorEditor
          data={data}
          periodId={period.id}
          recurringIds={selectedRecurForMirrors}
          abMode={abMode}
          setSlotsState={setSlotsState}
          refresh={refresh}
        />
      )}

      {demModal && (
        <DemandeursModal
          demandeurs={data.demandeurs}
          selected={slots.find((s) => s.id === demModal)?.demandeurIds ?? []}
          saving={saving}
          onClose={() => setDemModal(null)}
          onSave={async (ids) => {
            const id = demModal;
            update(id, { demandeurIds: ids });
            setDemModal(null);
            if (savedIds.has(id)) {
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
