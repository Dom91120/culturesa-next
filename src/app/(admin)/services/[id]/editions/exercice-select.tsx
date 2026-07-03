"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Sélecteur d'exercice des Éditions. Écrit `?exercice=<id>` dans l'URL (en conservant les
 * autres paramètres) et réinitialise la navigation de dates (date/week/trim/page) pour
 * repartir dans le nouvel exercice. Rendu uniquement s'il y a au moins un exercice.
 */
export function ExerciceSelect({
  exercices,
  selectedId,
}: {
  exercices: { id: number; label: string }[];
  selectedId: number | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  if (exercices.length === 0) return null;

  return (
    <select
      value={selectedId ?? ""}
      onChange={(e) => {
        const sp = new URLSearchParams(params.toString());
        sp.set("exercice", e.target.value);
        for (const k of ["date", "week", "trim", "page"]) sp.delete(k);
        router.push(`${pathname}?${sp.toString()}`);
      }}
      aria-label="Exercice"
      style={{
        fontSize: ".78rem",
        fontWeight: 600,
        padding: "3px 8px",
        borderRadius: 6,
        border: "1px solid var(--border)",
        background: "var(--surface1)",
        color: "var(--text)",
      }}
    >
      {exercices.map((ex) => (
        <option key={ex.id} value={ex.id}>
          {ex.label}
        </option>
      ))}
    </select>
  );
}
