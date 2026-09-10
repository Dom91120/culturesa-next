"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

type PeriodOpt = { id: number; label: string; dateStart: string | null; dateEnd: string | null };

const TYPES: { key: string; label: string }[] = [
  { key: "all", label: "Toutes" },
  { key: "rec", label: "Récurrentes" },
  { key: "uniq", label: "Ponctuelles" },
];

export function StatsFilters({
  type,
  dateFrom,
  dateTo,
  periods,
  exercices,
  selectedExerciceId,
}: {
  type: string;
  dateFrom: string;
  dateTo: string;
  periods: PeriodOpt[];
  exercices: { id: number; label: string }[];
  selectedExerciceId: number | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  // Met à jour (ou retire) des paramètres d'URL puis recharge la page serveur.
  const setParams = useCallback(
    (next: Record<string, string | null>) => {
      const sp = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(next)) {
        if (v) sp.set(k, v);
        else sp.delete(k);
      }
      router.push(`${pathname}?${sp.toString()}`);
    },
    [params, pathname, router],
  );

  // Sélection d'une période = raccourci qui remplit la plage de dates.
  function onPeriod(id: string) {
    const p = periods.find((x) => String(x.id) === id);
    setParams({ from: p?.dateStart ?? null, to: p?.dateEnd ?? null });
  }

  return (
    <div className="acct-toolbar" style={{ margin: ".6rem 0 .85rem" }}>
      {/* Exercice : filtre principal — définit la plage de dates des stats. Le changer
          réinitialise les affinages manuels (from/to). */}
      {exercices.length > 0 && (
        <select
          value={selectedExerciceId ?? ""}
          onChange={(e) => setParams({ exercice: e.target.value || null, from: null, to: null })}
          className="cfg-select"
          style={{ fontWeight: 600 }}
          aria-label="Exercice"
        >
          {exercices.map((ex) => (
            <option key={ex.id} value={ex.id}>
              {ex.label}
            </option>
          ))}
        </select>
      )}

      {/* Type : puces, comme les filtres d'Échanges. */}
      <div style={{ display: "inline-flex", gap: ".3rem" }}>
        {TYPES.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setParams({ type: t.key === "all" ? null : t.key })}
            aria-pressed={(type || "all") === t.key}
            className={`acct-chip${(type || "all") === t.key ? " is-on" : ""}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Période (raccourci de dates) */}
      {periods.length > 0 && (
        <select
          value=""
          onChange={(e) => onPeriod(e.target.value)}
          className="cfg-select"
          aria-label="Période"
        >
          <option value="">Période…</option>
          {periods.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      )}

      {/* Plage de dates */}
      <label className="cfg-date">
        Du
        <input
          type="date"
          className="cfg-select"
          value={dateFrom}
          onChange={(e) => setParams({ from: e.target.value || null })}
        />
      </label>
      <label className="cfg-date">
        Au
        <input
          type="date"
          className="cfg-select"
          value={dateTo}
          onChange={(e) => setParams({ to: e.target.value || null })}
        />
      </label>

      {(type || dateFrom || dateTo) && (
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => router.push(pathname)}
          style={{ padding: ".18rem .55rem", fontSize: ".66rem", color: "var(--muted)" }}
        >
          Réinitialiser
        </button>
      )}
    </div>
  );
}
