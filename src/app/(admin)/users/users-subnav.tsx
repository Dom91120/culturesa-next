"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type SubTab = { slug: string; label: string; icon: string };

const SUB_TABS: SubTab[] = [
  { slug: "comptes", label: "Comptes", icon: "👤" },
  { slug: "connectes", label: "Connectés", icon: "🟢" },
];

/**
 * Sous-navigation de l'onglet Administration › « Utilisateurs » : Comptes (gestion des
 * comptes) et Connectés (sessions ouvertes) — Dom 2026-09-07. Même charte que la
 * sous-navigation des tâches planifiées (`#params-subnav` / `.params-tab`).
 */
export function UsersSubnav() {
  const pathname = usePathname();
  return (
    <nav id="params-subnav" aria-label="Sous-navigation des utilisateurs">
      {SUB_TABS.map((t) => {
        const href = `/users/${t.slug}`;
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={t.slug}
            href={href}
            className={`params-tab${active ? " active" : ""}`}
            aria-current={active ? "page" : undefined}
          >
            <span aria-hidden="true">{t.icon}</span> {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
