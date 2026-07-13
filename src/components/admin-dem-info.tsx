"use client";

import { Fragment, useEffect, useState } from "react";

export type DemInfoRow = {
  demandeurId: number;
  label: string;
  validation: boolean;
  themes: boolean;
  openOnHolidays: boolean;
  openOnSchoolHolidays: boolean;
};

// Bandeau debug admin (port du legacy `dem-info-*`) : liste des demandeurs du
// service avec leurs modes (Validation, Thèmes — la jauge est portée par chaque
// créneau [slots.jauge] ; récurrent et A/B sont GLOBAUX au service
// [Service.recurrentMode/semaineAb]) et les deux flags d'ouverture (jours fériés /
// vacances scolaires), comme le bandeau debug de la page réservations. Affiché
// uniquement quand le mode debug est actif (localStorage `rc_debug` / classe
// `body.debug-mode`), activable depuis Configuration.
export function AdminDemInfo({ rows }: { rows: DemInfoRow[] }) {
  // Lecture côté client uniquement (comme le legacy) → initial false, donc pas de
  // décalage d'hydratation (le serveur ne rend rien).
  const [debug, setDebug] = useState(false);
  useEffect(() => {
    const read = () =>
      setDebug(
        document.body.classList.contains("debug-mode") || localStorage.getItem("rc_debug") === "1",
      );
    read();
    // Resync si le réglage change (bascule depuis l'onglet Configuration, ou autre
    // onglet du navigateur via l'événement storage).
    window.addEventListener("storage", read);
    return () => window.removeEventListener("storage", read);
  }, []);

  if (!debug || rows.length === 0) return null;

  const Flag = ({ on, label }: { on: boolean; label: string }) => (
    <span style={{ opacity: on ? 1 : 0.35 }}>
      {label} <strong>{on ? "✓" : "—"}</strong>
    </span>
  );

  return (
    <div
      className="dem-info"
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        columnGap: ".6rem",
        rowGap: ".3rem",
        alignItems: "center",
        fontSize: ".78rem",
        color: "var(--muted)",
        padding: ".6rem 0",
        marginTop: ".6rem",
      }}
    >
      {rows.map((r) => (
        <Fragment key={r.demandeurId}>
          <div style={{ color: "var(--text)", fontWeight: 600, textAlign: "right" }}>{r.label}</div>
          <div style={{ display: "flex", alignItems: "center", gap: ".6rem", flexWrap: "wrap" }}>
            <span style={{ color: "var(--border)" }}>|</span>
            <Flag on={r.validation} label="Validation" />
            <Flag on={r.themes} label="Thèmes" />
            <Flag on={r.openOnHolidays} label="Ouvert les jours fériés" />
            <Flag on={r.openOnSchoolHolidays} label="Ouvert vacances scolaires" />
          </div>
        </Fragment>
      ))}
    </div>
  );
}
