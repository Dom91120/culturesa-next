"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Navigation d'exercice façon Agenda (◀ libellé ▶). Écrit `?exercice=<id>` en conservant
 * les autres paramètres et réinitialise la navigation de dates (date/week/trim/page).
 * Exercices triés du plus ancien au plus récent (comme resolveEditionExercice).
 */
export function ExerciceNav({
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
  const idx = exercices.findIndex((e) => e.id === selectedId);
  const label = idx >= 0 ? exercices[idx].label : "—";
  const prev = idx > 0 ? exercices[idx - 1] : null;
  const next = idx >= 0 && idx < exercices.length - 1 ? exercices[idx + 1] : null;

  const go = (targetId: number) => {
    const sp = new URLSearchParams(params.toString());
    sp.set("exercice", String(targetId));
    for (const k of ["date", "week", "trim", "page"]) sp.delete(k);
    router.push(`${pathname}?${sp.toString()}`);
  };

  return (
    <span className="periode-nav no-print">
      <button
        type="button"
        className="ex-arrow"
        disabled={!prev}
        onClick={() => prev && go(prev.id)}
        aria-label="Exercice précédent"
      >
        ◀
      </button>
      <span className="ex-nav-label">{label}</span>
      <button
        type="button"
        className="ex-arrow"
        disabled={!next}
        onClick={() => next && go(next.id)}
        aria-label="Exercice suivant"
      >
        ▶
      </button>
    </span>
  );
}
