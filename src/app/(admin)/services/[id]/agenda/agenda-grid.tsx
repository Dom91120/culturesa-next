"use client";

import { useState } from "react";

type Service = {
  id: string;
  label: string;
  activeDays: string;
  morningStart: string;
  afternoonEnd: string;
};
type Period = { id: number; label: string; color: string };

const DAY_NAMES: Record<string, string> = {
  lun: "Lundi",
  mar: "Mardi",
  mer: "Mercredi",
  jeu: "Jeudi",
  ven: "Vendredi",
  sam: "Samedi",
  dim: "Dimanche",
};

const ROW_H = 56; // px par heure

function toMinutes(t: string, fallback: number): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return fallback;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function AgendaGrid({ service, periods }: { service: Service; periods: Period[] }) {
  const [periodIdx, setPeriodIdx] = useState(0);
  const [mode, setMode] = useState<"model" | "realweek">("model");
  const [hideEmpty, setHideEmpty] = useState(false);
  const [validation, setValidation] = useState(false);

  const days = service.activeDays.split(",").map((d) => d.trim()).filter(Boolean);

  const startMin = toMinutes(service.morningStart, 9 * 60);
  const endMin = toMinutes(service.afternoonEnd, 18 * 60);
  const firstHour = Math.floor(startMin / 60);
  const lastHour = Math.ceil(endMin / 60);
  const hours = Array.from({ length: lastHour - firstHour + 1 }, (_, i) => firstHour + i);
  const totalH = (lastHour - firstHour) * ROW_H;

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: ".75rem",
          flexWrap: "wrap",
          marginBottom: ".75rem",
        }}
      >
        <div className="panel-title" style={{ marginBottom: 0 }}>
          <span className="dot" />
          Agenda — {service.label}
        </div>
        <div style={{ display: "flex", gap: ".4rem", alignItems: "center" }}>
          <button
            type="button"
            className={`btn ${mode === "model" ? "btn-primary" : "btn-ghost"}`}
            style={{ fontSize: ".72rem", padding: ".25rem .7rem" }}
            onClick={() => setMode("model")}
          >
            Modèle de période
          </button>
          <button
            type="button"
            className={`btn ${mode === "realweek" ? "btn-primary" : "btn-ghost"}`}
            style={{ fontSize: ".72rem", padding: ".25rem .7rem" }}
            onClick={() => setMode("realweek")}
          >
            Semaine réelle
          </button>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: ".75rem",
          flexWrap: "wrap",
          marginBottom: ".75rem",
        }}
      >
        <div className="period-tabs">
          {periods.map((p, i) => (
            <button
              key={p.id}
              type="button"
              className={`period-btn ${i === periodIdx ? "active" : ""}`}
              style={{ "--period-color": p.color } as React.CSSProperties}
              onClick={() => setPeriodIdx(i)}
            >
              <span className="period-badge" />
              {p.label}
            </button>
          ))}
          {periods.length === 0 && (
            <span style={{ fontSize: ".75rem", color: "var(--muted)" }}>Aucune période active.</span>
          )}
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

      <div className="planning-wrap">
        <div className="agenda-grid" style={{ gridTemplateColumns: `44px repeat(${days.length}, 1fr)` }}>
          {/* En-tête */}
          <div className="agenda-header-cell agenda-corner" title="Horaires">
            🕘
          </div>
          {days.map((d) => (
            <div key={d} className="agenda-header-cell">
              {DAY_NAMES[d] ?? d}
            </div>
          ))}

          {/* Colonne des heures */}
          <div className="agenda-time-col" style={{ height: totalH }}>
            {hours.map((h) => (
              <div key={h} className="agenda-time-mark" style={{ top: (h - firstHour) * ROW_H }}>
                {String(h).padStart(2, "0")}:00
              </div>
            ))}
          </div>

          {/* Colonnes des jours */}
          {days.map((d) => (
            <div key={d} className="agenda-day-col" style={{ height: totalH }}>
              {hours.map((h) => (
                <div
                  key={h}
                  className="agenda-grid-line is-hour"
                  style={{ top: (h - firstHour) * ROW_H }}
                />
              ))}
              {/* Les blocs de réservation seront positionnés ici (sous-phase suivante). */}
            </div>
          ))}
        </div>
      </div>

      <p style={{ fontSize: ".72rem", color: "var(--muted)", marginTop: ".75rem" }}>
        Cadre de l&apos;agenda en place. Prochaine sous-phase : afficher les réservations (blocs
        positionnés + jauges), puis les modes A/B, le pointage et la création par clic.
      </p>
    </div>
  );
}
