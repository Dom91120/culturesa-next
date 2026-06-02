"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type SubTab = { slug: string; label: string; icon: string };

const SUB_TABS: SubTab[] = [
  { slug: "reservations", label: "Réservations", icon: "📝" },
  { slug: "periodes", label: "Périodes d'ouverture", icon: "🗓️" },
  { slug: "demandeurs", label: "Demandeurs", icon: "👥" },
  { slug: "themes", label: "Thèmes", icon: "🎨" },
  { slug: "exercice", label: "Changement d'exercice", icon: "🔄" },
  { slug: "rgpd", label: "RGPD", icon: "🛡️" },
];

/**
 * Sous-navigation de l'onglet « Paramètres » d'un service (charte legacy
 * `#params-subnav` / `.params-tab`). L'onglet actif est déterminé via le
 * dernier segment du chemin courant.
 */
export function ParamsSubnav({ serviceId }: { serviceId: string }) {
  const pathname = usePathname();
  return (
    <nav id="params-subnav" aria-label="Sous-navigation des paramètres">
      {SUB_TABS.map((t) => {
        const href = `/services/${serviceId}/${t.slug}`;
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
