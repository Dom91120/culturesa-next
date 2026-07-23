"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type SubTab = { slug: string; label: string; icon: string };

const SUB_TABS: SubTab[] = [
  { slug: "cron", label: "CRON", icon: "🕒" },
  { slug: "exports", label: "Exports", icon: "💾" },
];

/**
 * Sous-navigation de l'onglet « Tâches planifiées » (même charte que la
 * sous-navigation des paramètres d'un service : `#params-subnav` / `.params-tab`).
 */
export function TachesSubnav() {
  const pathname = usePathname();
  return (
    <nav id="params-subnav" aria-label="Sous-navigation des tâches planifiées">
      {SUB_TABS.map((t) => {
        const href = `/taches-planifiees/${t.slug}`;
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
