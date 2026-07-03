"use client";

import { useRouter } from "next/navigation";

// Sélecteur de tri de la Liste des réservations (segmented control façon agenda) :
// Alphabétique (Nom, Prénom) ou Par date (rupture par période). Navigue au clic.
export function ListeSortSelect({
  serviceId,
  tri,
  exerciceId,
}: {
  serviceId: string;
  tri: "alpha" | "date";
  exerciceId?: number | null;
}) {
  const router = useRouter();
  const base = `/services/${serviceId}/editions/liste`;
  const exq = exerciceId != null ? `&exercice=${exerciceId}` : "";
  const btnStyle: React.CSSProperties = { fontSize: ".68rem", letterSpacing: "-.02em" };

  return (
    <div className="agenda-mode-toggle no-print" role="tablist" aria-label="Tri de la liste">
      <button
        type="button"
        className={`agenda-mode-btn${tri === "alpha" ? " active" : ""}`}
        style={btnStyle}
        onClick={() => router.push(`${base}?tri=alpha${exq}`)}
      >
        Alphabétique
      </button>
      <button
        type="button"
        className={`agenda-mode-btn${tri === "date" ? " active" : ""}`}
        style={btnStyle}
        onClick={() => router.push(`${base}?tri=date${exq}`)}
      >
        Par date
      </button>
    </div>
  );
}
