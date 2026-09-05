"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { SIDEBAR_WRAP_STYLE, SidebarBrand, SidebarToggle, UserBar } from "@/components/app-shell";
import { useSidebarCollapse } from "@/components/use-sidebar-collapse";

type ServiceItem = { id: string; label: string; icon: string | null };

export function UserShell({
  user,
  services,
  children,
}: {
  user: { name: string; email: string; role?: string };
  services: ServiceItem[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  // Repli sidebar (préférence + fenêtre étroite), avec bascule mobile 640px : en mobile la
  // sidebar est une barre horizontale pleine largeur → l'état replié ne s'y applique jamais.
  const { effCollapsed, narrow, toggleSidebar } = useSidebarCollapse({ mobileBreakpoint: 640 });
  // Menu « sandwich » des services en mode smartphone (replié par défaut).
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const match = pathname.match(/^\/reservations\/([^/]+)/);
  const activeServiceId = match ? match[1] : null;
  // Libellé affiché sur le bouton sandwich : service actif, ou « Mon compte ».
  const activeService = services.find((s) => s.id === activeServiceId);
  const activeServiceLabel =
    activeService?.label ?? (pathname === "/mon-compte" ? "Mon compte" : "Activités");
  // Logo (icône) du service sélectionné, affiché sur le bouton sandwich mobile. Repli sur
  // 📄 (comme la sidebar) pour un service sans icône ; 👤 pour « Mon compte ».
  const activeServiceIcon = activeService
    ? activeService.icon || "📄"
    : pathname === "/mon-compte"
      ? "👤"
      : null;

  // Referme le menu sandwich après navigation (changement d'URL).
  // biome-ignore lint/correctness/useExhaustiveDependencies: on veut refermer à chaque changement de page.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  return (
    <main>
      <div className="app-layout">
        <div
          id="service-sidebar-wrap"
          className={`${effCollapsed ? "collapsed" : ""}${mobileNavOpen ? " mobile-open" : ""}`}
          style={SIDEBAR_WRAP_STYLE}
        >
          <SidebarToggle narrow={narrow} toggleSidebar={toggleSidebar} />
          {/* Bouton « sandwich » visible uniquement en mode smartphone (CSS) :
                déplie/replie la liste des services affichée sur plusieurs lignes. */}
          <button
            type="button"
            id="mobile-services-toggle"
            aria-expanded={mobileNavOpen}
            aria-controls="service-sidebar"
            onClick={() => setMobileNavOpen((o) => !o)}
          >
            <span className="mst-burger" aria-hidden="true">
              ☰
            </span>
            {activeServiceIcon && (
              <span className="mst-icon" aria-hidden="true">
                {activeServiceIcon}
              </span>
            )}
            <span className="mst-label">{activeServiceLabel}</span>
            <span className="mst-caret" aria-hidden="true">
              ▾
            </span>
          </button>
          {/* Marque dans la sidebar (comme le shell admin) : plus de bandeau-titre en haut. */}
          <SidebarBrand />

          <div className="sidebar-label">Réservations</div>
          <div id="service-sidebar">
            {/* Sidebar repliée : seuls les icônes restent visibles → info-bulle native
                  (title) avec le libellé au survol. Dépliée : pas de title (redondant). */}
            {services.map((s) => (
              <button
                key={s.id}
                type="button"
                className={activeServiceId === s.id ? "active" : ""}
                title={effCollapsed ? s.label : undefined}
                onClick={() => router.push(`/reservations/${s.id}`)}
              >
                <span className="sb-icon">{s.icon || "📄"}</span>
                <span className="sb-label">{s.label}</span>
              </button>
            ))}
            {services.length === 0 && (
              <p style={{ fontSize: ".78rem", color: "var(--muted)", padding: ".4rem" }}>
                Aucune activité disponible.
              </p>
            )}

            {/* (Plus d'entrée « Mon compte » ici : elle vit dans le menu du bloc
                  utilisateur ci-dessous — elle figurait en double, Dom 2026-08-30.) */}
          </div>

          {/* Barre utilisateur épinglée en BAS de la sidebar (cf. UserBar). */}
          <UserBar user={user} />
        </div>

        <div className="app-main">{children}</div>
      </div>
    </main>
  );
}
