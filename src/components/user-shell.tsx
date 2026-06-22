"use client";

import { ONBOARDING_REPLAY_EVENT } from "@/components/onboarding-modal";
import { ThemeToggle } from "@/components/theme-toggle";
import { signOut } from "@/lib/auth-client";
import { initialsOf } from "@/lib/format";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type ServiceItem = { id: string; label: string; icon: string | null };

export function UserShell({
  user,
  services,
  children,
}: {
  user: { name: string; email: string };
  services: ServiceItem[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  // Menu « sandwich » des services en mode smartphone (replié par défaut).
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // Mode smartphone (même breakpoint que la media query CSS, 640px) : en mobile la sidebar
  // est une barre horizontale pleine largeur → l'état « collapsed » (toggle desktop) ne doit
  // JAMAIS s'y appliquer, même s'il a été activé avant de réduire la fenêtre.
  const [isMobile, setIsMobile] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

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

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, []);

  async function onLogout() {
    await signOut();
    router.push("/auth/login");
    router.refresh();
  }

  return (
    <>
      <div className="user-bar" id="user-bar">
        <div className="user-pill-wrap" ref={menuRef}>
          <button
            type="button"
            className="user-pill"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            <div className="avatar">{initialsOf(user.name, user.email)}</div>
            <span id="user-display-name" style={{ fontSize: ".78rem", color: "var(--text)" }}>
              {user.name || user.email}
            </span>
            <span style={{ fontSize: ".6rem", color: "var(--muted)" }}>▾</span>
          </button>
          <div id="user-menu" className={menuOpen ? "open" : ""}>
            <button
              type="button"
              onClick={() => {
                router.push("/mon-compte");
                setMenuOpen(false);
              }}
            >
              👤 Mon compte
            </button>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                window.dispatchEvent(new Event(ONBOARDING_REPLAY_EVENT));
              }}
            >
              💡 Revoir la présentation
            </button>
            <button type="button" className="danger" onClick={onLogout}>
              ⏏ Déconnexion
            </button>
          </div>
        </div>
        <ThemeToggle />
      </div>

      <main>
        <div className="app-layout">
          <div
            id="service-sidebar-wrap"
            className={`${collapsed && !isMobile ? "collapsed" : ""}${mobileNavOpen ? " mobile-open" : ""}`}
            style={{
              width: "18%",
              minWidth: "fit-content",
              maxWidth: 300,
              flexShrink: 0,
              position: "relative",
            }}
          >
            <button
              type="button"
              id="sidebar-toggle"
              onClick={() => setCollapsed((c) => !c)}
              title="Réduire / agrandir"
            >
              ☰
            </button>
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
            <div className="sidebar-header">
              <div
                className="sidebar-title"
                style={{ fontSize: "1rem", fontWeight: "bolder", color: "var(--text)" }}
              >
                <span className="sidebar-title-resa">Cultu</span>
                <em style={{ color: "var(--accent)", fontStyle: "italic" }}>Résa</em>
              </div>
              <div className="sidebar-tagline">Réservation d&apos;activités culturelles</div>
            </div>

            <div className="sidebar-label">Réservations</div>
            <div id="service-sidebar">
              {services.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={activeServiceId === s.id ? "active" : ""}
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

              {/* « Mon compte » en dernière position de la sidebar (comme le shell admin). */}
              <button
                type="button"
                className={`sidebar-compte-btn${pathname === "/mon-compte" ? " active" : ""}`}
                style={{ marginTop: ".6rem" }}
                onClick={() => router.push("/mon-compte")}
              >
                <span className="sb-icon">👤</span>
                <span className="sb-label">Mon compte</span>
              </button>
            </div>
          </div>

          <div className="app-main">{children}</div>
        </div>
      </main>
    </>
  );
}
