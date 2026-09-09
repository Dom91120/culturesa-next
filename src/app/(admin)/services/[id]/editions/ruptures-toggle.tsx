"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

// Pastille à bascule « avec ruptures » (sous-totaux par semaine/mois/période — libellé
// surchargeable, ex. « rupture par demandeur » des créneaux ouverts). Défaut = OFF
// (`defaultOn` pour les écrans cochés d'office, ex. créneaux ouverts) ; le param
// `ruptures=1|0` devient explicite au premier clic. Toggle en conservant les autres
// paramètres d'URL. Refonte Dom 2026-09-09 : pastille.
export function RupturesToggle({
  label = "Ruptures",
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
    <button
      type="button"
      className={`acct-chip no-print${on ? " is-on" : ""}`}
      aria-pressed={on}
      onClick={toggle}
    >
      {label}
    </button>
  );
}
