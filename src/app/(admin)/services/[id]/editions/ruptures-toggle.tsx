"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

// Case à cocher « avec ruptures » (sous-totaux par semaine/mois/période). OFF par défaut
// (param `ruptures=1` absent). Toggle en conservant les autres paramètres d'URL.
export function RupturesToggle() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const on = params.get("ruptures") === "1";

  const toggle = () => {
    const p = new URLSearchParams(params.toString());
    if (on) p.delete("ruptures");
    else p.set("ruptures", "1");
    const qs = p.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  return (
    <label
      className="no-print"
      style={{
        display: "flex",
        alignItems: "center",
        gap: ".3rem",
        fontSize: ".66rem",
        color: "var(--muted)",
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      <input type="checkbox" checked={on} onChange={toggle} style={{ cursor: "pointer" }} />
      avec ruptures
    </label>
  );
}
