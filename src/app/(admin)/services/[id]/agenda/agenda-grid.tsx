"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  deleteBookingAdminAction,
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
  dayKey: string;
  top: number;
  height: number;
  leftPct: number;
  widthPct: number;
  used: number;
  capacity: number;
  full: boolean;
};

type Menu = { block: Block; x: number; y: number } | null;

export function AgendaGrid({
  service,
  periods,
  slots,
  bookings,
}: {
  service: Service;
  periods: Period[];
  slots: Slot[];
  bookings: Booking[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [periodIdx, setPeriodIdx] = useState(0);
  const [mode, setMode] = useState<"model" | "realweek">("model");
  const [hideEmpty, setHideEmpty] = useState(false);
  const [validation, setValidation] = useState(false);
  const [menu, setMenu] = useState<Menu>(null);

  const days = service.activeDays.split(",").map((d) => d.trim()).filter(Boolean);
  const startMin = toMinutes(service.morningStart, 9 * 60);
  const endMin = toMinutes(service.afternoonEnd, 18 * 60);
  const firstHour = Math.floor(startMin / 60);
  const lastHour = Math.ceil(endMin / 60);
  const hours = Array.from({ length: lastHour - firstHour + 1 }, (_, i) => firstHour + i);
  const gridStartMin = firstHour * 60;
  const totalH = (lastHour - firstHour) * ROW_H;
  const pxPerMin = ROW_H / 60;
  const selectedPeriodId = periods[periodIdx]?.id ?? null;

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
          dayKey,
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
    // Attaché au tick suivant pour ne pas capter le clic qui vient d'ouvrir le menu.
    const t = setTimeout(() => document.addEventListener("click", onDoc), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("click", onDoc);
    };
  }, [menu]);

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

      <div className="planning-wrap" style={{ opacity: pending ? 0.6 : 1 }}>
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
            <div key={d} className="agenda-day-col" style={{ height: totalH }}>
              {hours.map((h) => (
                <div key={h} className="agenda-grid-line is-hour" style={{ top: (h - firstHour) * ROW_H }} />
              ))}
              {(blocksByDay[d] ?? []).map((b) => {
                const pct = Math.min(100, b.capacity > 0 ? (b.used / b.capacity) * 100 : 0);
                const bk = b.booking;
                const pendingValidation = validation && !bk.validated;
                return (
                  <div
                    key={bk.id}
                    className={`agenda-block${b.full ? " is-full" : ""}`}
                    style={{
                      top: b.top,
                      height: b.height,
                      left: `calc(${b.leftPct}% + 2px)`,
                      width: `calc(${b.widthPct}% - 4px)`,
                      opacity: bk.validated ? 1 : 0.78,
                      outline: pendingValidation ? "2px solid var(--warn)" : undefined,
                      outlineOffset: -2,
                    }}
                    title={`${bk.demandeur} — ${bk.name}`}
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
        <div
          style={{
            position: "fixed",
            top: menu.y + 4,
            left: menu.x + 4,
            zIndex: 9999,
            background: "var(--surface2)",
            border: "1px solid var(--border)",
            borderRadius: "var(--rad-sm)",
            boxShadow: "0 6px 20px rgba(0,0,0,.25)",
            minWidth: 180,
            overflow: "hidden",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <MenuItem onClick={() => run(setBookingValidatedAction(menu.block.booking.id, service.id, !menu.block.booking.validated))}>
            {menu.block.booking.validated ? "↩ Dévalider" : "✓ Valider"}
          </MenuItem>
          <MenuItem onClick={() => run(setBookingPointageAction(menu.block.booking.id, service.id, "present"))}>
            ✅ Présent
          </MenuItem>
          <MenuItem onClick={() => run(setBookingPointageAction(menu.block.booking.id, service.id, "absent"))}>
            ❌ Absent
          </MenuItem>
          {menu.block.booking.pointage && (
            <MenuItem onClick={() => run(setBookingPointageAction(menu.block.booking.id, service.id, null))}>
              ⚪ Effacer le pointage
            </MenuItem>
          )}
          <MenuItem danger onClick={() => run(deleteBookingAdminAction(menu.block.booking.id, service.id))}>
            🗑️ Supprimer
          </MenuItem>
        </div>
      )}
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: ".4rem .8rem",
        background: "none",
        border: "none",
        fontFamily: "inherit",
        fontSize: ".8rem",
        cursor: "pointer",
        color: danger ? "var(--danger)" : "var(--text)",
      }}
    >
      {children}
    </button>
  );
}
