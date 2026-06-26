"use client";

import { useRouter } from "next/navigation";

// Sélecteur de tri de la Liste des réservations (segmented control façon agenda) :
// Alphabétique (Nom, Prénom) ou Par date (rupture par période). Navigue au clic.
export function ListeSortSelect({
  serviceId,
  tri,
}: {
  serviceId: string;
  tri: "alpha" | "date";
}) {
  const router = useRouter();
  const base = `/services/${serviceId}/editions/liste`;
  const btnStyle: React.CSSProperties = { fontSize: ".68rem", letterSpacing: "-.02em" };

  return (
    <div className="agenda-mode-toggle no-print" role="tablist" aria-label="Tri de la liste">
      <button
        type="button"
        className={`agenda-mode-btn${tri === "alpha" ? " active" : ""}`}
        style={btnStyle}
        onClick={() => router.push(`${base}?tri=alpha`)}
      >
        Alphabétique
      </button>
      <button
        type="button"
        className={`agenda-mode-btn${tri === "date" ? " active" : ""}`}
        style={btnStyle}
        onClick={() => router.push(`${base}?tri=date`)}
      >
        Par date
      </button>
    </div>
  );
}
