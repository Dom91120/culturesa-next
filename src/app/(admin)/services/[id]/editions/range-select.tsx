"use client";

import { useRouter } from "next/navigation";

// Sélecteur de granularité des éditions (segmented control façon agenda) :
// Hebdomadaire / Mensuel / Trimestriel / Annuel. La navigation fine (semaine, mois,
// trimestre) se fait ensuite via les flèches ◀ ▶ de la barre. Partagé par Plannings,
// Pointages et la Liste « par date ».
export function RangeSelect({
  serviceId,
  screen,
  mode,
  date,
  ruptures = false,
}: {
  serviceId: string;
  screen: string;
  mode: "week" | "month" | "trimester" | "year";
  date: string;
  ruptures?: boolean;
}) {
  const router = useRouter();
  const base = `/services/${serviceId}/editions/${screen}`;
  const rq = ruptures ? "&ruptures=1" : "";
  const go = (qs: string) => router.push(`${base}?${qs}${rq}`);
  const btnStyle: React.CSSProperties = {
    fontSize: ".68rem",
    letterSpacing: "-.02em",
    whiteSpace: "nowrap",
  };

  // Hebdo/Mensuel conservent la date courante (navigation libre) ; Trimestriel/Annuel
  // se calculent sur l'exercice → pas de date à transmettre.
  const items: { key: typeof mode; label: string; qs: string }[] = [
    { key: "week", label: "Hebdomadaire", qs: `mode=week&date=${date}` },
    { key: "month", label: "Mensuel", qs: `mode=month&date=${date}` },
    { key: "trimester", label: "Trimestriel", qs: "mode=trimester" },
    { key: "year", label: "Annuel", qs: "mode=year" },
  ];

  return (
    <div className="agenda-mode-toggle no-print" role="tablist" aria-label="Vue">
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          className={`agenda-mode-btn${mode === it.key ? " active" : ""}`}
          style={btnStyle}
          onClick={() => go(it.qs)}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
