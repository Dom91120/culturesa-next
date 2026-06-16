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

// Ligne de réglage (libellé + contrôle), calée sur le style des lignes de « Réservations ».
// fontSize .62rem : le libellé du <label> est rendu en MAJUSCULES (règle globale `label`) ;
// on le cale donc sur .62rem comme les autres libellés majuscules de l'app.
const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: ".5rem",
  fontSize: ".62rem",
  flexWrap: "wrap",
};
// Sous-titre de section (panel-subtitle, .85rem) — identique à « Réservations / Périodes ».
const subtitleStyle: React.CSSProperties = { fontSize: ".85rem", fontWeight: 500 };
const selectStyle: React.CSSProperties = {
  fontSize: ".78rem",
  padding: ".15rem .4rem",
  borderRadius: "var(--rad-sm)",
  border: "1px solid var(--border)",
  background: "var(--surface2)",
  color: "var(--text)",
};

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
      <div className="panel-title" style={{ marginBottom: ".75rem" }}>
        <span className="dot" style={{ background: "var(--warn)" }} />
        Configuration
      </div>

      {/* ─ Vacances scolaires ─ */}
      <div className="panel-subtitle" style={{ ...subtitleStyle, margin: "0 0 .75rem" }}>
        Vacances scolaires
      </div>
      <label style={rowStyle}>
        Zone
        <select value={zone} onChange={(e) => onZoneChange(e.target.value)} style={selectStyle}>
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
        <span style={{ fontSize: ".62rem", color: "var(--muted)" }}>
          {info ?? `${count} période(s) en base`}
        </span>
      </label>

      {/* ─ Application ─ */}
      <div className="panel-subtitle" style={{ ...subtitleStyle, margin: "1.5rem 0 .75rem" }}>
        Application
      </div>
      <label style={rowStyle}>
        URL
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
            fontSize: ".78rem",
            padding: ".2rem .45rem",
            borderRadius: "var(--rad-sm)",
            border: "1px solid var(--border)",
            background: "var(--surface2)",
            color: "var(--text)",
            minWidth: 220,
          }}
        />
        {appUrlSaved && (
          <span style={{ fontSize: ".72rem", color: "var(--accent)" }}>✅ Enregistré</span>
        )}
        <span style={{ fontSize: ".62rem", color: "var(--muted)" }}>
          Lien « Portail CultuRésa » des e-mails. Laisser vide pour ne pas afficher de lien.
        </span>
      </label>

      {/* ─ Rafraîchissement automatique ─ */}
      <div className="panel-subtitle" style={{ ...subtitleStyle, margin: "1.5rem 0 .75rem" }}>
        Rafraîchissement automatique
      </div>
      <label style={rowStyle}>
        Réservations
        <select
          value={refreshSeconds}
          onChange={(e) => onRefreshChange(Number(e.target.value))}
          disabled={pending}
          style={selectStyle}
        >
          {REFRESH_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <span style={{ fontSize: ".62rem", color: "var(--muted)" }}>
          {refreshSaved
            ? "Enregistré ✓"
            : "Fréquence de mise à jour de la disponibilité côté usager."}
        </span>
      </label>
      <label style={{ ...rowStyle, marginTop: ".5rem" }}>
        Agenda
        <select
          value={agendaRefresh}
          onChange={(e) => onAgendaRefreshChange(Number(e.target.value))}
          disabled={pending}
          style={selectStyle}
        >
          {REFRESH_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <span style={{ fontSize: ".62rem", color: "var(--muted)" }}>
          {agendaRefreshSaved
            ? "Enregistré ✓"
            : "Fréquence de mise à jour de l'agenda côté gestionnaire."}
        </span>
      </label>

      {/* ─ Avancé ─ */}
      <div className="panel-subtitle" style={{ ...subtitleStyle, margin: "1.5rem 0 .75rem" }}>
        Avancé
      </div>
      <label style={{ ...rowStyle, cursor: "pointer", userSelect: "none" }}>
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
