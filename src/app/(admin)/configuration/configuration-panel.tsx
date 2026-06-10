"use client";

import { useEffect, useState, useTransition } from "react";
import {
  refreshSchoolHolidaysAction,
  setAgendaRefreshAction,
  setAppUrlAction,
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
  appUrl: string;
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
  appUrl: initialAppUrl,
}: Props) {
  const [zone, setZone] = useState(initialZone === "B" || initialZone === "C" ? initialZone : "A");
  const [count, setCount] = useState(holidayCount);
  const [refreshSeconds, setRefreshSeconds] = useState(initialRefresh);
  const [refreshSaved, setRefreshSaved] = useState(false);
  const [agendaRefresh, setAgendaRefresh] = useState(initialAgendaRefresh);
  const [agendaRefreshSaved, setAgendaRefreshSaved] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [appUrl, setAppUrl] = useState(initialAppUrl);
  const [appUrlSaved, setAppUrlSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  // URL de l'application (lien « Portail CultuRésa » des e-mails) — enregistrée à la
  // perte de focus.
  function saveAppUrl() {
    if (appUrl.trim() === initialAppUrl.trim()) return;
    setAppUrlSaved(false);
    startTransition(async () => {
      const res = await setAppUrlAction(appUrl.trim());
      if (res?.ok) setAppUrlSaved(true);
    });
  }

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
        URL de l'application
        <input
          type="url"
          value={appUrl}
          placeholder="https://culturesa.exemple.fr"
          onChange={(e) => {
            setAppUrl(e.target.value);
            setAppUrlSaved(false);
          }}
          onBlur={saveAppUrl}
          disabled={pending}
          style={{
            fontSize: ".85rem",
            padding: ".25rem .45rem",
            borderRadius: "var(--rad-sm)",
            border: "1px solid var(--border)",
            background: "var(--surface2)",
            color: "var(--text)",
            minWidth: 260,
          }}
        />
        {appUrlSaved && (
          <span style={{ fontSize: ".72rem", color: "var(--accent)" }}>✅ Enregistré</span>
        )}
        <span style={{ fontSize: ".72rem", color: "var(--muted)", flexBasis: "100%" }}>
          Lien « Portail CultuRésa » des e-mails. Laisser vide pour ne pas afficher de lien.
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
