"use client";

import { useMemo, useState } from "react";
import { type CreneauxData, SLOT_PAGE_SIZE, type SaveResult, slotWeekTag } from "./shared";

type Props = {
  data: CreneauxData;
  periodId: number;
  recurringIds: string[];
  abMode: boolean;
  setSlotsState: (ids: string[], state: string) => Promise<SaveResult>;
  refresh: () => void;
};

function fmtDate(d: string): string {
  return new Date(`${d}T00:00`).toLocaleDateString("fr-FR");
}

export function MirrorEditor({
  data,
  periodId,
  recurringIds,
  abMode,
  setSlotsState,
  refresh,
}: Props) {
  // Concrete dated occurrences (mirrors) of the selected recurring slots,
  // limited to the active period. Includes active + désactivés.
  const mirrors = useMemo(
    () =>
      data.slots
        .filter(
          (s) =>
            s.slotType === "unique" &&
            s.parentSlotId != null &&
            recurringIds.includes(s.parentSlotId) &&
            s.periodId === periodId,
        )
        .sort((a, b) => {
          const d = (a.slotDate ?? "").localeCompare(b.slotDate ?? "");
          return d !== 0 ? d : a.startTime.localeCompare(b.startTime);
        }),
    [data.slots, recurringIds, periodId],
  );

  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const totalPages = Math.max(1, Math.ceil(mirrors.length / SLOT_PAGE_SIZE));
  const pageClamped = Math.min(page, totalPages - 1);
  const pageRows = mirrors.slice(pageClamped * SLOT_PAGE_SIZE, (pageClamped + 1) * SLOT_PAGE_SIZE);

  function toggle(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function disableSelected() {
    if (selected.size === 0) return;
    if (!window.confirm(`Désactiver ${selected.size} occurrence(s) ?`)) return;
    setBusy(true);
    const res = await setSlotsState([...selected], "desactive");
    setBusy(false);
    if (res.ok) {
      setSelected(new Set());
      refresh();
    }
  }

  return (
    <div
      id="section-creneaux-miroirs"
      style={{
        marginTop: "1.5rem",
        borderTop: "1px solid rgba(255,255,255,.07)",
        paddingTop: "1.5rem",
      }}
    >
      <div className="panel-title">
        <span className="dot" style={{ background: "var(--warn)" }} />
        Dates correspondantes
      </div>

      <div id="cap-editor-mir" className="planning-wrap">
        <table className="admin-table cap-editor-table">
          <thead>
            <tr>
              <th className="col-check" style={{ width: 32 }} />
              {abMode && <th style={{ width: 80, textAlign: "center" }}>Semaine</th>}
              <th style={{ width: 130, textAlign: "center" }}>Date</th>
              <th style={{ width: 70, textAlign: "center" }}>Début</th>
              <th style={{ width: 70, textAlign: "center" }}>Fin</th>
              <th style={{ width: 80, textAlign: "center" }}>Capacité</th>
              <th style={{ width: 90, textAlign: "center" }}>État</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((m) => (
              <tr key={m.id} style={m.state === "actif" ? undefined : { opacity: 0.55 }}>
                <td className="col-check">
                  <input
                    type="checkbox"
                    className="admin-cb"
                    checked={selected.has(m.id)}
                    disabled={m.state !== "actif"}
                    onChange={(e) => toggle(m.id, e.target.checked)}
                  />
                </td>
                {abMode && (
                  <td style={{ textAlign: "center", fontSize: ".7rem", fontWeight: 700 }}>
                    {m.slotDate ? slotWeekTag(m.slotDate) : ""}
                  </td>
                )}
                <td style={{ textAlign: "center" }}>{m.slotDate ? fmtDate(m.slotDate) : "—"}</td>
                <td style={{ textAlign: "center" }}>{m.startTime}</td>
                <td style={{ textAlign: "center", color: "var(--muted)" }}>{m.endTime}</td>
                <td style={{ textAlign: "center" }}>{m.capacity ?? "—"}</td>
                <td style={{ textAlign: "center", fontSize: ".72rem", color: "var(--muted)" }}>
                  {m.state === "actif" ? "actif" : "désactivé"}
                </td>
              </tr>
            ))}
            {mirrors.length === 0 && (
              <tr>
                <td
                  colSpan={abMode ? 7 : 6}
                  style={{ textAlign: "center", color: "var(--muted)", padding: ".6rem" }}
                >
                  Aucune occurrence générée. Enregistrez le créneau pour générer ses dates.
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
          <button
            type="button"
            className="btn btn-ghost"
            onClick={disableSelected}
            disabled={busy}
            style={{
              borderColor: "rgba(220,80,80,.4)",
              color: "#e05555",
              fontSize: ".7rem",
              padding: ".2rem .6rem",
            }}
          >
            Désactiver
          </button>
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
        <div />
      </div>
    </div>
  );
}
