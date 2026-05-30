"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  createRecurringBookingAction,
  deleteBookingAdminAction,
  moveBookingAction,
  setBookingPointageAction,
  setBookingValidatedAction,
} from "./actions";

type Service = {
  id: string;
  label: string;
  activeDays: string;
  morningStart: string;
  afternoonEnd: string;
  recurCapacity: number;
};
type Period = { id: number; label: string; color: string };
type Slot = { id: string; startTime: string; endTime: string; capacity: number | null };
type Pointage = "present" | "absent" | null;
type Booking = {
  id: number;
  slotId: string;
  periodId: number;
  dayKey: string;
  enfants: number;
  theme: string;
  validated: boolean;
  pointage: Pointage;
  name: string;
  demandeur: string;
};
type UserOpt = { id: string; label: string };

const DAY_NAMES: Record<string, string> = {
  lun: "Lundi",
  mar: "Mardi",
  mer: "Mercredi",
  jeu: "Jeudi",
  ven: "Vendredi",
  sam: "Samedi",
  dim: "Dimanche",
};

const ROW_H = 56;

function toMinutes(t: string, fallback: number): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return fallback;
  return Number(m[1]) * 60 + Number(m[2]);
}

type Block = {
  booking: Booking;
  top: number;
  height: number;
  leftPct: number;
  widthPct: number;
  used: number;
  capacity: number;
  full: boolean;
};
type Menu = { block: Block; x: number; y: number } | null;
type CreateCtx = { dayKey: string; slotId: string } | null;

export function AgendaGrid({
  service,
  periods,
  slots,
  bookings,
  users,
}: {
  service: Service;
  periods: Period[];
  slots: Slot[];
  bookings: Booking[];
  users: UserOpt[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [periodIdx, setPeriodIdx] = useState(0);
  const [mode, setMode] = useState<"model" | "realweek">("model");
  const [hideEmpty, setHideEmpty] = useState(false);
  const [validation, setValidation] = useState(false);
  const [menu, setMenu] = useState<Menu>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [createCtx, setCreateCtx] = useState<CreateCtx>(null);
  const [cUser, setCUser] = useState("");
  const [cEnfants, setCEnfants] = useState("0");
  const [cTheme, setCTheme] = useState("");
  const [cError, setCError] = useState<string | null>(null);

  const days = service.activeDays.split(",").map((d) => d.trim()).filter(Boolean);
  const startMin = toMinutes(service.morningStart, 9 * 60);
  const endMin = toMinutes(service.afternoonEnd, 18 * 60);
  const baseFirst = Math.floor(startMin / 60);
  const baseLast = Math.ceil(endMin / 60);
  const pxPerMin = ROW_H / 60;
  const selectedPeriodId = periods[periodIdx]?.id ?? null;

  // "Masquer les horaires sans réservation" : resserre la grille sur la plage
  // horaire réellement occupée par des réservations de la période active.
  let firstHour = baseFirst;
  let lastHour = baseLast;
  if (hideEmpty) {
    const bookedSlotIds = new Set(
      bookings.filter((b) => selectedPeriodId == null || b.periodId === selectedPeriodId).map((b) => b.slotId),
    );
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (const s of slots) {
      if (!bookedSlotIds.has(s.id)) continue;
      lo = Math.min(lo, toMinutes(s.startTime, startMin));
      hi = Math.max(hi, toMinutes(s.endTime, endMin));
    }
    if (hi > lo) {
      firstHour = Math.max(baseFirst, Math.floor(lo / 60));
      lastHour = Math.min(baseLast, Math.ceil(hi / 60));
    }
  }

  const hours = Array.from({ length: lastHour - firstHour + 1 }, (_, i) => firstHour + i);
  const gridStartMin = firstHour * 60;
  const totalH = (lastHour - firstHour) * ROW_H;

  const slotsParsed = useMemo(
    () =>
      slots.map((s) => ({
        ...s,
        startMin: toMinutes(s.startTime, gridStartMin),
        endMin: toMinutes(s.endTime, gridStartMin + 60),
      })),
    [slots, gridStartMin],
  );

  function slotAtClientY(colTop: number, clientY: number) {
    const minute = gridStartMin + (clientY - colTop) / pxPerMin;
    return slotsParsed.find((s) => minute >= s.startMin && minute < s.endMin) ?? null;
  }

  const blocksByDay = useMemo(() => {
    const slotById = new Map(slots.map((s) => [s.id, s]));
    const groups = new Map<string, Booking[]>();
    for (const b of bookings) {
      if (selectedPeriodId != null && b.periodId !== selectedPeriodId) continue;
      const key = `${b.dayKey}|${b.slotId}`;
      const arr = groups.get(key) ?? [];
      arr.push(b);
      groups.set(key, arr);
    }
    const byDay: Record<string, Block[]> = {};
    for (const [key, list] of groups) {
      const [dayKey, slotId] = key.split("|");
      const slot = slotById.get(slotId);
      if (!slot) continue;
      const s = toMinutes(slot.startTime, gridStartMin);
      const e = toMinutes(slot.endTime, s + 60);
      const capacity = slot.capacity ?? service.recurCapacity;
      const used = list.reduce((sum, b) => sum + b.enfants, 0);
      const full = used >= capacity;
      list.forEach((booking, i) => {
        (byDay[dayKey] ??= []).push({
          booking,
          top: (s - gridStartMin) * pxPerMin,
          height: Math.max(28, (e - s) * pxPerMin),
          leftPct: (i / list.length) * 100,
          widthPct: (1 / list.length) * 100,
          used,
          capacity,
          full,
        });
      });
    }
    return byDay;
  }, [bookings, slots, selectedPeriodId, gridStartMin, pxPerMin, service.recurCapacity]);

  function run(p: Promise<unknown>) {
    setMenu(null);
    startTransition(async () => {
      await p;
      router.refresh();
    });
  }

  useEffect(() => {
    if (!menu) return;
    function onDoc() {
      setMenu(null);
    }
    const t = setTimeout(() => document.addEventListener("click", onDoc), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("click", onDoc);
    };
  }, [menu]);

  function openCreate(dayKey: string, slotId: string) {
    setCUser("");
    setCEnfants("0");
    setCTheme("");
    setCError(null);
    setCreateCtx({ dayKey, slotId });
  }

  function submitCreate() {
    if (!createCtx || selectedPeriodId == null) return;
    if (!cUser) {
      setCError("Choisissez un usager.");
      return;
    }
    startTransition(async () => {
      const res = await createRecurringBookingAction({
        serviceId: service.id,
        slotId: createCtx.slotId,
        periodId: selectedPeriodId,
        dayKey: createCtx.dayKey,
        userId: cUser,
        enfants: Number(cEnfants) || 0,
        theme: cTheme,
      });
      if (!res.ok) {
        setCError(res.error ?? "Échec.");
        return;
      }
      setCreateCtx(null);
      router.refresh();
    });
  }

  const createSlot = createCtx ? slots.find((s) => s.id === createCtx.slotId) : null;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: ".75rem", flexWrap: "wrap", marginBottom: ".75rem" }}>
        <div className="panel-title" style={{ marginBottom: 0 }}>
          <span className="dot" />
          Agenda — {service.label}
        </div>
        <div style={{ display: "flex", gap: ".4rem", alignItems: "center" }}>
          <button type="button" className={`btn ${mode === "model" ? "btn-primary" : "btn-ghost"}`} style={{ fontSize: ".72rem", padding: ".25rem .7rem" }} onClick={() => setMode("model")}>
            Modèle de période
          </button>
          <button type="button" className={`btn ${mode === "realweek" ? "btn-primary" : "btn-ghost"}`} style={{ fontSize: ".72rem", padding: ".25rem .7rem" }} onClick={() => setMode("realweek")}>
            Semaine réelle
          </button>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: ".75rem", flexWrap: "wrap", marginBottom: ".75rem" }}>
        <div className="period-tabs">
          {periods.map((p, i) => (
            <button key={p.id} type="button" className={`period-btn ${i === periodIdx ? "active" : ""}`} style={{ "--period-color": p.color } as React.CSSProperties} onClick={() => setPeriodIdx(i)}>
              <span className="period-badge" />
              {p.label}
            </button>
          ))}
          {periods.length === 0 && <span style={{ fontSize: ".75rem", color: "var(--muted)" }}>Aucune période active.</span>}
        </div>
        <div className="planning-options-row">
          <label className="planning-option">
            <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} />
            Masquer les horaires sans réservation
          </label>
          <label className="planning-option">
            <input type="checkbox" checked={validation} onChange={(e) => setValidation(e.target.checked)} />
            Mode validation
          </label>
        </div>
      </div>

      <p style={{ fontSize: ".7rem", color: "var(--muted)", marginBottom: ".4rem" }}>
        Astuce : cliquez sur un créneau vide pour ajouter une réservation, ou glissez un bloc vers
        un autre créneau pour le déplacer.
      </p>

      <div className="planning-wrap">
        <div className="agenda-grid" style={{ gridTemplateColumns: `44px repeat(${days.length}, 1fr)` }}>
          <div className="agenda-header-cell agenda-corner" title="Horaires">
            🕘
          </div>
          {days.map((d) => (
            <div key={d} className="agenda-header-cell">
              {DAY_NAMES[d] ?? d}
            </div>
          ))}

          <div className="agenda-time-col" style={{ height: totalH }}>
            {hours.map((h) => (
              <div key={h} className="agenda-time-mark" style={{ top: (h - firstHour) * ROW_H }}>
                {String(h).padStart(2, "0")}:00
              </div>
            ))}
          </div>

          {days.map((d) => (
            // biome-ignore lint/a11y/useKeyWithClickEvents: grille agenda (clic = créer)
            <div
              key={d}
              className="agenda-day-col"
              style={{ height: totalH, cursor: "cell" }}
              onClick={(e) => {
                const slot = slotAtClientY(e.currentTarget.getBoundingClientRect().top, e.clientY);
                if (slot && selectedPeriodId != null) openCreate(d, slot.id);
              }}
              onDragOver={(e) => {
                if (draggingId != null) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (draggingId == null) return;
                const slot = slotAtClientY(e.currentTarget.getBoundingClientRect().top, e.clientY);
                const id = draggingId;
                setDraggingId(null);
                if (slot) run(moveBookingAction(id, service.id, d, slot.id));
              }}
            >
              {hours.map((h) => (
                <div key={h} className="agenda-grid-line is-hour" style={{ top: (h - firstHour) * ROW_H }} />
              ))}
              {/* Lanes des créneaux (repère visuel + cible de clic/drop, via la colonne) */}
              {slotsParsed.map((s) => (
                <div
                  key={s.id}
                  style={{
                    position: "absolute",
                    left: 2,
                    right: 2,
                    top: (s.startMin - gridStartMin) * pxPerMin,
                    height: Math.max(20, (s.endMin - s.startMin) * pxPerMin),
                    border: "1px dashed rgba(127,127,127,.25)",
                    borderRadius: "var(--rad-sm)",
                    background: "rgba(127,127,127,.03)",
                    pointerEvents: "none",
                  }}
                />
              ))}
              {(blocksByDay[d] ?? []).map((b) => {
                const pct = Math.min(100, b.capacity > 0 ? (b.used / b.capacity) * 100 : 0);
                const bk = b.booking;
                const pendingValidation = validation && !bk.validated;
                return (
                  // biome-ignore lint/a11y/useKeyWithClickEvents: bloc agenda (clic = menu)
                  <div
                    key={bk.id}
                    className={`agenda-block${b.full ? " is-full" : ""}`}
                    draggable
                    style={{
                      top: b.top,
                      height: b.height,
                      left: `calc(${b.leftPct}% + 2px)`,
                      width: `calc(${b.widthPct}% - 4px)`,
                      opacity: draggingId === bk.id ? 0.4 : bk.validated ? 1 : 0.78,
                      outline: pendingValidation ? "2px solid var(--warn)" : undefined,
                      outlineOffset: -2,
                      pointerEvents: draggingId != null && draggingId !== bk.id ? "none" : undefined,
                    }}
                    title={`${bk.demandeur} — ${bk.name}`}
                    onDragStart={() => setDraggingId(bk.id)}
                    onDragEnd={() => setDraggingId(null)}
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenu({ block: b, x: e.clientX, y: e.clientY });
                    }}
                  >
                    <div style={{ position: "absolute", top: 1, right: 3, fontSize: ".6rem" }}>
                      {!bk.validated && "⏳"}
                      {bk.pointage === "present" && "✅"}
                      {bk.pointage === "absent" && "❌"}
                    </div>
                    <div className="agenda-block-chips">
                      {bk.demandeur && <div style={{ fontSize: ".6rem", color: "var(--muted)" }}>{bk.demandeur}</div>}
                      <div className="planning-name-tag">
                        <span>{bk.name}</span>
                      </div>
                      {bk.theme && <span style={{ fontSize: ".6rem", color: "var(--muted)" }}>{bk.theme}</span>}
                    </div>
                    <div className="agenda-block-meta is-gauge">
                      <span className="agenda-block-gauge-bar">
                        <span style={{ width: `${pct}%`, background: b.full ? "var(--danger)" : "var(--accent)" }} />
                      </span>
                      {b.used}/{b.capacity}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {menu && (
        // biome-ignore lint/a11y/useKeyWithClickEvents: menu contextuel
        <div
          style={{ position: "fixed", top: menu.y + 4, left: menu.x + 4, zIndex: 9999, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--rad-sm)", boxShadow: "0 6px 20px rgba(0,0,0,.25)", minWidth: 180, overflow: "hidden" }}
          onClick={(e) => e.stopPropagation()}
        >
          <MenuItem onClick={() => run(setBookingValidatedAction(menu.block.booking.id, service.id, !menu.block.booking.validated))}>
            {menu.block.booking.validated ? "↩ Dévalider" : "✓ Valider"}
          </MenuItem>
          <MenuItem onClick={() => run(setBookingPointageAction(menu.block.booking.id, service.id, "present"))}>✅ Présent</MenuItem>
          <MenuItem onClick={() => run(setBookingPointageAction(menu.block.booking.id, service.id, "absent"))}>❌ Absent</MenuItem>
          {menu.block.booking.pointage && (
            <MenuItem onClick={() => run(setBookingPointageAction(menu.block.booking.id, service.id, null))}>⚪ Effacer le pointage</MenuItem>
          )}
          <MenuItem danger onClick={() => run(deleteBookingAdminAction(menu.block.booking.id, service.id))}>🗑️ Supprimer</MenuItem>
        </div>
      )}

      {createCtx && (
        <div className="modal-overlay open" onClick={() => setCreateCtx(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">
              Nouvelle réservation — {DAY_NAMES[createCtx.dayKey] ?? createCtx.dayKey}
              {createSlot ? ` · ${createSlot.startTime}–${createSlot.endTime}` : ""}
            </div>
            <div className="form-grid">
              <div className="field full">
                <label htmlFor="ag-user">Usager</label>
                <select id="ag-user" value={cUser} onChange={(e) => setCUser(e.target.value)}>
                  <option value="">— choisir —</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="ag-enfants">Enfants</label>
                <input id="ag-enfants" type="number" min={0} value={cEnfants} onChange={(e) => setCEnfants(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="ag-theme">Thème</label>
                <input id="ag-theme" value={cTheme} onChange={(e) => setCTheme(e.target.value)} placeholder="(optionnel)" />
              </div>
            </div>
            {cError && <p className="field-error" style={{ display: "block" }}>{cError}</p>}
            <div className="btn-row">
              <button type="button" className="btn btn-ghost" onClick={() => setCreateCtx(null)}>
                Annuler
              </button>
              <button type="button" className="btn btn-primary" onClick={submitCreate}>
                Créer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuItem({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ display: "block", width: "100%", textAlign: "left", padding: ".4rem .8rem", background: "none", border: "none", fontFamily: "inherit", fontSize: ".8rem", cursor: "pointer", color: danger ? "var(--danger)" : "var(--text)" }}
    >
      {children}
    </button>
  );
}
