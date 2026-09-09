"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { UserOffGlyph } from "@/app/(admin)/users/account-ui";

// Pastille à bascule « comptes anonymisés » (Liste des inscrits). OFF par défaut (param
// `anonymises=1` absent) : un compte anonymisé n'a plus ni nom ni contact — il n'apparaît
// que sur demande, pour recouper un effectif. Même patron que RupturesToggle (toggle
// d'un paramètre d'URL en conservant les autres). Refonte Dom 2026-09-09 : pastille.
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
    <button
      type="button"
      className={`acct-chip no-print${on ? " is-on" : ""}`}
      aria-pressed={on}
      onClick={toggle}
      title={on ? "Masquer les comptes anonymisés" : "Afficher aussi les comptes anonymisés"}
      style={{ display: "inline-flex", alignItems: "center", gap: ".3rem" }}
    >
      <UserOffGlyph size={11} /> Comptes anonymisés
    </button>
  );
}
