"use client";

import { useMemo, useState } from "react";
import { DemandeursModal } from "./demandeurs-modal";
import { DurationStepper } from "./duration-stepper";
import { MirrorEditor } from "./mirror-editor";
import {
  ALLDAY_DURATION,
  type CreneauxData,
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
  duration: number;
  capacity: number;
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

// Modèle « un slot = un jour » : le buffer est une liste plate de créneaux mono-jour.
// Pour conserver la grille (lignes = horaires, colonnes = jours), on regroupe à
// l'affichage les slots partageant le même triplet (début, fin, semaines).
type Row = {
  key: string;
  startTime: string;
  endTime: string;
  weeks: string;
  cells: EditRecurSlot[]; // un slot par jour présent
};

function rowKey(s: { startTime: string; endTime: string; weeks: string }): string {
  return `${s.startTime}|${s.endTime}|${s.weeks}`;
}

export function RecurringEditor({
  serviceId: _serviceId,
  data,
  duration,
  capacity,
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

  // Recurring slots (mono-jour) for the selected period, as a flat edit buffer.
  const initialSlots = useMemo<EditRecurSlot[]>(() => {
    if (!period) return [];
    return data.slots
      .filter((s) => s.slotType === "recurring" && s.periodId === period.id && s.state === "actif")
      .filter((s): s is typeof s & { slotDay: DayKey } =>
        (DAY_KEYS as readonly string[]).includes(s.slotDay ?? ""),
      )
      .sort((a, b) => a.startTime.localeCompare(b.startTime))
      .map((s) => ({
        id: s.id,
        startTime: s.startTime,
        endTime: s.endTime,
        weeks: s.weeks ?? "",
        slotDay: s.slotDay,
        capacity: s.capacity ?? capacity,
        demandeurIds: [...s.demandeurIds],
      }));
  }, [data.slots, period, capacity]);

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

  // Regroupe le buffer plat en lignes (par début/fin/semaines).
  const rows = useMemo<Row[]>(() => {
    const map = new Map<string, EditRecurSlot[]>();
    for (const s of slots) {
      const key = rowKey(s);
      const arr = map.get(key) ?? [];
      arr.push(s);
      map.set(key, arr);
    }
    return [...map.entries()]
      .map(([key, cells]) => ({
        key,
        startTime: cells[0].startTime,
        endTime: cells[0].endTime,
        weeks: cells[0].weeks,
        cells,
      }))
      .sort((a, b) => a.startTime.localeCompare(b.startTime) || a.weeks.localeCompare(b.weeks));
  }, [slots]);

  const totalPages = Math.max(1, Math.ceil(rows.length / SLOT_PAGE_SIZE));
  const pageClamped = Math.min(page, totalPages - 1);
  const pageRows = rows.slice(pageClamped * SLOT_PAGE_SIZE, (pageClamped + 1) * SLOT_PAGE_SIZE);

  function reserved(id: string): boolean {
    const sl = data.slots.find((s) => s.id === id);
    return sl ? sl.bookingCount > 0 : false;
  }
  const rowChecked = (row: Row) =>
    row.cells.length > 0 && row.cells.every((c) => selected.has(c.id));
  const rowReserved = (row: Row) => row.cells.some((c) => reserved(c.id));
  const cellOf = (row: Row, day: DayKey) => row.cells.find((c) => c.slotDay === day) ?? null;

  // Patch des slots d'une ligne (par ids de cellules).
  function patchCells(ids: string[], patch: Partial<EditRecurSlot>) {
    setSlots((prev) => prev.map((s) => (ids.includes(s.id) ? { ...s, ...patch } : s)));
  }

  function setRowStart(row: Row, value: string) {
    const start = value.replace("h", ":");
    const endTime = duration < ALLDAY_DURATION && start ? addMinutes(start, duration) : "";
    patchCells(
      row.cells.map((c) => c.id),
      { startTime: start, endTime },
    );
  }

  // Passe une ligne en « journée entière » (efface début + fin).
  function setAllDay(row: Row) {
    patchCells(
      row.cells.map((c) => c.id),
      { startTime: "", endTime: "" },
    );
  }

  // Redonne des horaires à une ligne « journée entière ».
  function initTimes(row: Row) {
    const dur = duration < ALLDAY_DURATION ? duration : 60;
    patchCells(
      row.cells.map((c) => c.id),
      { startTime: "09:00", endTime: addMinutes("09:00", dur) },
    );
  }

  function setWeeks(row: Row, weeks: string) {
    patchCells(
      row.cells.map((c) => c.id),
      { weeks },
    );
  }

  function setCellCap(slotId: string, value: number | null) {
    setSlots((prev) => prev.map((s) => (s.id === slotId ? { ...s, capacity: value ?? 0 } : s)));
  }

  // Active un jour sur une ligne : crée un slot mono-jour reprenant horaires/semaines.
  function addCell(row: Row, day: DayKey) {
    const id = newClientSlotId();
    setSlots((prev) => [
      ...prev,
      {
        id,
        startTime: row.startTime,
        endTime: row.endTime,
        weeks: row.weeks,
        slotDay: day,
        capacity: capacity,
        demandeurIds: [...(row.cells[0]?.demandeurIds ?? [])],
      },
    ]);
    setSelected((prev) => new Set(prev).add(id));
  }

  // Retire un jour : supprime le slot mono-jour du buffer.
  function removeCell(slotId: string) {
    setSlots((prev) => prev.filter((s) => s.id !== slotId));
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(slotId);
      return next;
    });
  }

  function addSlot() {
    const days = dayCols.filter((d) => filterDays.has(d));
    if (days.length === 0) {
      setNotice("Cochez au moins un jour avant d'ajouter un créneau.");
      return;
    }
    // Durée = 1 jour → créneau « journée entière » : pas d'horaire (début/fin vides).
    const allday = duration >= ALLDAY_DURATION;
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
        duration,
        ranges,
      );
      if (startMin == null) {
        setNotice(
          "Plus de place dans les plages horaires — créneau « journée entière » ajouté, ajustez les horaires.",
        );
      } else {
        start = minToTime(startMin);
      }
    }
    const endTime = start ? addMinutes(start, duration) : "";
    const newCells: EditRecurSlot[] = days.map((day) => ({
      id: newClientSlotId(),
      startTime: start,
      endTime,
      // Modèle « 1 créneau = 1 semaine » : en mode A/B, par défaut semaine A (jamais
      // « A & B ») ; hors A/B, "" = toutes les semaines.
      weeks: abMode ? "A" : "",
      slotDay: day,
      capacity: capacity,
      demandeurIds: [],
    }));
    setSlots((prev) => [...prev, ...newCells]);
    setSelected((prev) => new Set([...prev, ...newCells.map((c) => c.id)]));
    setPage(Math.floor(rows.length / SLOT_PAGE_SIZE));
  }

  function toggleRow(row: Row, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const c of row.cells) {
        if (on) next.add(c.id);
        else next.delete(c.id);
      }
      return next;
    });
  }

  async function deleteSelected() {
    if (selected.size === 0) return;
    if ([...selected].some((id) => reserved(id))) return;
    const ids = [...selected];
    if (!window.confirm(`Supprimer ${ids.length} créneau(x) récurrent(s) ?`)) return;
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
    const capVal = Math.max(1, capacity);
    if (slots.length === 0) return;
    if (
      !window.confirm(
        `Cette action va remplacer la capacité de tous les créneaux récurrents par « ${capVal} ».`,
      )
    ) {
      return;
    }
    setSlots((prev) => prev.map((s) => ({ ...s, capacity: capVal })));
  }

  const anyReservedSelected = [...selected].some((id) => reserved(id));
  // Mirror sub-section visible when at least one persisted recurring slot is selected.
  const selectedRecurForMirrors = [...selected].filter((id) => savedIds.has(id));
  const demRow = demModal ? rows.find((r) => r.key === demModal) : null;

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
            <DurationStepper value={duration} onStep={onDurationStep} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: ".4rem" }}>
            <span className="cap-tool-label">Capacité</span>
            <input
              type="number"
              min={1}
              max={999}
              value={capacity}
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
                  {pageRows.map((row) => {
                    const checked = rowChecked(row);
                    const isReserved = rowReserved(row);
                    const disTime = !checked || isReserved;
                    const rowDemandeurs = row.cells[0]?.demandeurIds ?? [];
                    return (
                      <tr key={row.key}>
                        <td className="col-check">
                          <input
                            type="checkbox"
                            className="admin-cb"
                            checked={checked}
                            onChange={(e) => toggleRow(row, e.target.checked)}
                          />
                        </td>
                        {abMode &&
                          (checked ? (
                            <td style={{ textAlign: "center" }}>
                              <select
                                value={row.weeks}
                                onChange={(e) => setWeeks(row, e.target.value)}
                                style={{ fontSize: ".72rem", padding: "1px 3px" }}
                              >
                                <option value="A">Semaine A</option>
                                <option value="B">Semaine B</option>
                              </select>
                            </td>
                          ) : (
                            <td style={{ textAlign: "center", fontSize: ".7rem", fontWeight: 700 }}>
                              {weekLabel(row.weeks)}
                            </td>
                          ))}
                        {isAllDay(row.startTime, row.endTime) ? (
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
                                onClick={() => initTimes(row)}
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
                                  value={row.startTime}
                                  disabled={disTime}
                                  onChange={(e) => setRowStart(row, e.target.value)}
                                  placeholder="09:30"
                                  style={{ width: 58, fontSize: ".78rem", textAlign: "center" }}
                                />
                                {!disTime && (
                                  <button
                                    type="button"
                                    className="cell-clear-btn"
                                    title="Passer en journée entière (sans horaire)"
                                    onClick={() => setAllDay(row)}
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
                                value={row.endTime}
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
                          const cell = cellOf(row, d);
                          const cellReserved = cell ? reserved(cell.id) : false;
                          if (cell) {
                            return (
                              <td key={d} style={{ textAlign: "center" }}>
                                <span
                                  style={{ display: "inline-flex", alignItems: "center", gap: 2 }}
                                >
                                  <input
                                    type="number"
                                    min={0}
                                    max={99}
                                    value={cell.capacity}
                                    disabled={!checked}
                                    onChange={(e) =>
                                      setCellCap(
                                        cell.id,
                                        Math.max(0, Number.parseInt(e.target.value, 10) || 0),
                                      )
                                    }
                                    style={{ width: 52, textAlign: "center", fontSize: ".78rem" }}
                                  />
                                  {checked && !cellReserved && (
                                    <button
                                      type="button"
                                      className="cell-clear-btn"
                                      title="Retirer ce jour"
                                      onClick={() => removeCell(cell.id)}
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
                                  onClick={() => addCell(row, d)}
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
                            onClick={() => setDemModal(row.key)}
                            title={
                              rowDemandeurs.length
                                ? `${rowDemandeurs.length} demandeur(s) autorisé(s)`
                                : "Aucune restriction"
                            }
                            style={{
                              padding: "1px 5px",
                              fontSize: ".78rem",
                              ...(rowDemandeurs.length
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
                  {rows.length === 0 && (
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

      {demRow && (
        <DemandeursModal
          demandeurs={data.demandeurs}
          selected={demRow.cells[0]?.demandeurIds ?? []}
          saving={saving}
          onClose={() => setDemModal(null)}
          onSave={async (ids) => {
            const cellIds = demRow.cells.map((c) => c.id);
            patchCells(cellIds, { demandeurIds: ids });
            setDemModal(null);
            // Propage en base pour les cellules déjà enregistrées.
            const persisted = cellIds.filter((id) => savedIds.has(id));
            if (persisted.length) {
              for (const id of persisted) {
                const res = await setDemandeurs(id, ids);
                if (!res.ok) {
                  setError(res.error ?? "Échec.");
                  return;
                }
              }
              refresh();
            }
          }}
        />
      )}
    </div>
  );
}
