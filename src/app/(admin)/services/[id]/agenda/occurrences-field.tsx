import { fmtDateLongFr, fmtSlotHoursFr } from "./agenda-format";

/**
 * Champ « Créneaux concernés » des modales récurrentes (port legacy
 * pcm/bdet-occurrences-field) : dates concrètes en grille 3 colonnes, chacune
 * suivie de la plage horaire du créneau. Côté next, les occurrences d'un récurrent
 * sont ses créneaux miroirs (slots datés `parentSlotId`), cf. MEMORY.
 */
export function OccurrencesField({
  dates,
  startTime,
  endTime,
}: {
  dates: string[];
  startTime?: string;
  endTime?: string;
}) {
  if (!dates.length) return null;
  const times = fmtSlotHoursFr(startTime, endTime);
  return (
    <div className="field full">
      <span
        style={{
          fontSize: ".65rem",
          fontWeight: 600,
          letterSpacing: ".1em",
          textTransform: "uppercase",
          color: "var(--muted)",
        }}
      >
        Créneaux concernés
      </span>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: ".15rem .75rem",
          fontSize: ".65rem",
          color: "var(--muted)",
          lineHeight: 1.4,
          maxHeight: 200,
          overflowY: "auto",
        }}
      >
        {dates.map((d) => (
          <div key={d}>
            • {fmtDateLongFr(d)} {times}
          </div>
        ))}
      </div>
    </div>
  );
}
