"use client";

import { useEffect, useState, useTransition } from "react";
import {
  refreshSchoolHolidaysAction,
  setAgendaRefreshAction,
  setDebugModeAction,
  setReservationsRefreshAction,
  setSchoolZoneAction,
} from "./actions";

type Props = {
  zone: string;
  holidayCount: number;
  refreshSeconds: number;
  agendaRefreshSeconds: number;
  debugMode: boolean;
};

// Choix proposés pour l'auto-rafraîchissement de la page Réservations (en secondes).
const REFRESH_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "Désactivé" },
  { value: 15, label: "15 secondes" },
  { value: 30, label: "30 secondes" },
  { value: 60, label: "1 minute" },
  { value: 120, label: "2 minutes" },
  { value: 300, label: "5 minutes" },
];

export function ConfigurationPanel({
  zone: initialZone,
  holidayCount,
  refreshSeconds: initialRefresh,
  agendaRefreshSeconds: initialAgendaRefresh,
  debugMode: initialDebug,
}: Props) {
  const [zone, setZone] = useState(initialZone === "B" || initialZone === "C" ? initialZone : "A");
  const [count, setCount] = useState(holidayCount);
  const [refreshSeconds, setRefreshSeconds] = useState(initialRefresh);
  const [refreshSaved, setRefreshSaved] = useState(false);
  const [agendaRefresh, setAgendaRefresh] = useState(initialAgendaRefresh);
  const [agendaRefreshSaved, setAgendaRefreshSaved] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onRefreshChange(value: number) {
    setRefreshSeconds(value);
    setRefreshSaved(false);
    startTransition(async () => {
      const res = await setReservationsRefreshAction(value);
      if (res?.ok) setRefreshSaved(true);
    });
  }

  function onAgendaRefreshChange(value: number) {
    setAgendaRefresh(value);
    setAgendaRefreshSaved(false);
    startTransition(async () => {
      const res = await setAgendaRefreshAction(value);
      if (res?.ok) setAgendaRefreshSaved(true);
    });
  }

  // Mode debug : source de vérité SERVEUR (app_config `debug.mode`, lu côté serveur).
  // On garde en plus localStorage + classe body pour le style debug legacy côté client.
  const [debug, setDebug] = useState(initialDebug);
  useEffect(() => {
    // Synchronise le client (localStorage/body) sur la valeur serveur au chargement.
    localStorage.setItem("rc_debug", initialDebug ? "1" : "0");
    document.body.classList.toggle("debug-mode", initialDebug);
  }, [initialDebug]);

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
    // Client (style debug legacy) + serveur (source de vérité lue par les écrans).
    localStorage.setItem("rc_debug", on ? "1" : "0");
    document.body.classList.toggle("debug-mode", on);
    startTransition(async () => {
      await setDebugModeAction(on);
    });
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
          fontSize: ".85rem",
          flexWrap: "wrap",
          marginTop: ".75rem",
        }}
      >
        Réservations — rafraîchissement automatique
        <select
          value={refreshSeconds}
          onChange={(e) => onRefreshChange(Number(e.target.value))}
          disabled={pending}
          style={{
            fontSize: ".85rem",
            padding: ".2rem .4rem",
            borderRadius: "var(--rad-sm)",
            border: "1px solid var(--border)",
            background: "var(--surface2)",
            color: "var(--text)",
          }}
        >
          {REFRESH_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <span style={{ fontSize: ".72rem", color: "var(--muted)" }}>
          {refreshSaved
            ? "Enregistré ✓"
            : "Fréquence de mise à jour de la disponibilité côté usager."}
        </span>
      </label>

      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: ".5rem",
          fontSize: ".85rem",
          flexWrap: "wrap",
          marginTop: ".75rem",
        }}
      >
        Agenda — rafraîchissement automatique
        <select
          value={agendaRefresh}
          onChange={(e) => onAgendaRefreshChange(Number(e.target.value))}
          disabled={pending}
          style={{
            fontSize: ".85rem",
            padding: ".2rem .4rem",
            borderRadius: "var(--rad-sm)",
            border: "1px solid var(--border)",
            background: "var(--surface2)",
            color: "var(--text)",
          }}
        >
          {REFRESH_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <span style={{ fontSize: ".72rem", color: "var(--muted)" }}>
          {agendaRefreshSaved
            ? "Enregistré ✓"
            : "Fréquence de mise à jour de l'agenda côté gestionnaire."}
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
