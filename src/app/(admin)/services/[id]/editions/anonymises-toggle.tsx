"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

// Case à cocher « afficher les comptes anonymisés » (Liste des inscrits). OFF par
// défaut (param `anonymises=1` absent) : un compte anonymisé n'a plus ni nom ni
// contact — il n'apparaît que sur demande, pour recouper un effectif. Même patron
// que RupturesToggle (toggle d'un paramètre d'URL en conservant les autres).
export function AnonymisesToggle() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const on = params.get("anonymises") === "1";

  const toggle = () => {
    const p = new URLSearchParams(params.toString());
    if (on) p.delete("anonymises");
    else p.set("anonymises", "1");
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
        fontSize: ".6rem",
        color: "var(--muted)",
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      <input type="checkbox" checked={on} onChange={toggle} style={{ cursor: "pointer" }} />
      afficher les comptes anonymisés
    </label>
  );
}
