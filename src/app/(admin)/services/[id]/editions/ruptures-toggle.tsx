"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

// Case à cocher « avec ruptures » (sous-totaux par semaine/mois/période — libellé
// surchargeable, ex. « rupture par demandeur » des créneaux ouverts). Défaut = OFF
// (`defaultOn` pour les écrans cochés d'office, ex. créneaux ouverts) ; le param
// `ruptures=1|0` devient explicite au premier clic. Toggle en conservant les autres
// paramètres d'URL.
export function RupturesToggle({
  label = "avec ruptures",
  defaultOn = false,
}: {
  label?: string;
  defaultOn?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const raw = params.get("ruptures");
  const on = raw == null ? defaultOn : raw === "1";

  const toggle = () => {
    const p = new URLSearchParams(params.toString());
    p.set("ruptures", on ? "0" : "1");
    router.push(`${pathname}?${p.toString()}`);
  };

  return (
    <label
      className="no-print"
      style={{
        display: "flex",
        alignItems: "center",
        gap: ".3rem",
        fontSize: ".6rem",
        color: "var(--muted)",
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      <input type="checkbox" checked={on} onChange={toggle} style={{ cursor: "pointer" }} />
      {label}
    </label>
  );
}
