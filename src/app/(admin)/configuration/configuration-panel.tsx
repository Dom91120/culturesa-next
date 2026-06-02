"use client";

import { useEffect, useState, useTransition } from "react";
import { refreshSchoolHolidaysAction, setSchoolZoneAction } from "./actions";

type Props = { zone: string; holidayCount: number };

export function ConfigurationPanel({ zone: initialZone, holidayCount }: Props) {
  const [zone, setZone] = useState(initialZone === "B" || initialZone === "C" ? initialZone : "A");
  const [count, setCount] = useState(holidayCount);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Mode debug : strictement côté client (localStorage + classe body), comme l'ancien.
  const [debug, setDebug] = useState(false);
  useEffect(() => {
    const on = localStorage.getItem("rc_debug") === "1";
    setDebug(on);
    document.body.classList.toggle("debug-mode", on);
  }, []);

  function onZoneChange(z: string) {
    setZone(z);
    setInfo(null);
    startTransition(async () => {
      await setSchoolZoneAction(z);
    });
  }

  function refresh() {
    setInfo("Chargement…");
    startTransition(async () => {
      const res = await refreshSchoolHolidaysAction(zone);
      if (res?.ok) {
        if (typeof res.count === "number") setCount(res.count);
        setInfo(`✅ ${res.imported ?? 0} période(s) importée(s)`);
      } else {
        setInfo(`⚠️ ${res?.error ?? "Échec du rafraîchissement"}`);
      }
    });
  }

  function onDebugChange(on: boolean) {
    setDebug(on);
    localStorage.setItem("rc_debug", on ? "1" : "0");
    document.body.classList.toggle("debug-mode", on);
  }

  return (
    <div className="panel">
      <div className="panel-title" style={{ padding: ".3rem 0" }}>
        <span className="dot" style={{ background: "var(--warn)" }} />
        Configuration
      </div>

      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: ".5rem",
          fontSize: ".85rem",
          flexWrap: "wrap",
        }}
      >
        Vacances scolaires — zone
        <select
          value={zone}
          onChange={(e) => onZoneChange(e.target.value)}
          style={{
            fontSize: ".85rem",
            padding: ".2rem .4rem",
            borderRadius: "var(--rad-sm)",
            border: "1px solid var(--border)",
            background: "var(--surface2)",
            color: "var(--text)",
          }}
        >
          <option value="A">A</option>
          <option value="B">B</option>
          <option value="C">C</option>
        </select>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={refresh}
          disabled={pending}
          title="Rafraîchir depuis data.education.gouv.fr"
          style={{
            fontSize: ".75rem",
            padding: ".2rem .55rem",
            borderColor: "color-mix(in srgb, var(--accent) 40%, transparent)",
            color: "var(--accent)",
          }}
        >
          🔄 Rafraîchir
        </button>
        <span style={{ fontSize: ".72rem", color: "var(--muted)" }}>
          {info ?? `${count} période(s) en base`}
        </span>
      </label>

      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: ".5rem",
          cursor: "pointer",
          fontSize: ".85rem",
          userSelect: "none",
          marginTop: ".75rem",
        }}
      >
        Mode debug
        <input
          type="checkbox"
          className="admin-cb"
          checked={debug}
          onChange={(e) => onDebugChange(e.target.checked)}
          style={{ accentColor: "var(--accent)", width: 14, height: 14 }}
        />
      </label>
    </div>
  );
}
