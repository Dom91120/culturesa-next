"use client";

import { useRouter } from "next/navigation";

// Sélecteur de vue, façon segmented control de l'agenda (« Modèle de période / Semaine
// réelle ») : Hebdomadaire / Mensuel + un niveau par PÉRIODE longue (> 1 mois). Partagé
// par les écrans Plannings et Pointages (`screen` = segment de page). Navigue au clic.
export function RangeSelect({
  serviceId,
  screen,
  mode,
  date,
  periodId,
  periods,
  ruptures = false,
}: {
  serviceId: string;
  screen: string;
  mode: "week" | "month" | "period";
  date: string;
  periodId: number | null;
  periods: { id: number; label: string }[];
  ruptures?: boolean;
}) {
  const router = useRouter();
  const base = `/services/${serviceId}/editions/${screen}`;
  const rq = ruptures ? "&ruptures=1" : "";
  const go = (qs: string) => router.push(`${base}?${qs}${rq}`);
  // Police plus petite que le segmented control de l'agenda (override de .agenda-mode-btn).
  const btnStyle: React.CSSProperties = { fontSize: ".56rem" };

  return (
    <div className="agenda-mode-toggle" role="tablist" aria-label="Vue">
      <button
        type="button"
        className={`agenda-mode-btn${mode === "week" ? " active" : ""}`}
        style={btnStyle}
        onClick={() => go(`mode=week&date=${date}`)}
      >
        Hebdomadaire
      </button>
      <button
        type="button"
        className={`agenda-mode-btn${mode === "month" ? " active" : ""}`}
        style={btnStyle}
        onClick={() => go(`mode=month&date=${date}`)}
      >
        Mensuel
      </button>
      {periods.map((p) => (
        <button
          key={p.id}
          type="button"
          className={`agenda-mode-btn${mode === "period" && periodId === p.id ? " active" : ""}`}
          style={btnStyle}
          onClick={() => go(`mode=period&periodId=${p.id}`)}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
