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
}: {
  type: string;
  dateFrom: string;
  dateTo: string;
  periods: PeriodOpt[];
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

  const inputStyle: React.CSSProperties = {
    fontSize: ".8rem",
    padding: "3px 6px",
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "var(--surface1)",
    color: "var(--text)",
  };

  return (
    <div
      style={{
        display: "flex",
        gap: ".75rem",
        flexWrap: "wrap",
        alignItems: "center",
        marginBottom: "1rem",
      }}
    >
      {/* Type */}
      <div
        style={{
          display: "inline-flex",
          gap: 2,
          background: "var(--surface2)",
          borderRadius: 8,
          padding: 2,
        }}
      >
        {TYPES.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setParams({ type: t.key === "all" ? null : t.key })}
            className="btn"
            style={{
              fontSize: ".76rem",
              padding: "3px 10px",
              borderRadius: 6,
              border: "none",
              background: (type || "all") === t.key ? "var(--accent)" : "transparent",
              color: (type || "all") === t.key ? "#fff" : "var(--text)",
              cursor: "pointer",
            }}
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
          style={inputStyle}
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
      <label
        style={{
          fontSize: ".78rem",
          color: "var(--muted)",
          display: "inline-flex",
          gap: 4,
          alignItems: "center",
        }}
      >
        Du
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setParams({ from: e.target.value || null })}
          style={inputStyle}
        />
      </label>
      <label
        style={{
          fontSize: ".78rem",
          color: "var(--muted)",
          display: "inline-flex",
          gap: 4,
          alignItems: "center",
        }}
      >
        Au
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setParams({ to: e.target.value || null })}
          style={inputStyle}
        />
      </label>

      {(type || dateFrom || dateTo) && (
        <button
          type="button"
          className="btn"
          onClick={() => router.push(pathname)}
          style={{ ...inputStyle, cursor: "pointer", color: "var(--muted)" }}
        >
          Réinitialiser
        </button>
      )}
    </div>
  );
}
