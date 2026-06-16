"use client";

import { ThemeToggle } from "@/components/theme-toggle";
import { signOut } from "@/lib/auth-client";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export type ServiceItem = { id: string; label: string; icon: string | null };
type Tab = { href: string; label: string; icon: string };

const ADMIN_TABS: Tab[] = [
  { href: "/services", label: "Services", icon: "🏷️" },
  { href: "/users", label: "Comptes utilisateurs", icon: "👥" },
  { href: "/messagerie", label: "Messagerie", icon: "✉️" },
  { href: "/configuration", label: "Configuration", icon: "⚙️" },
  { href: "/rgpd", label: "RGPD", icon: "🛡️" },
];

function serviceTabs(id: string): Tab[] {
  return [
    { href: `/services/${id}/agenda`, label: "Agenda", icon: "📆" },
    { href: `/services/${id}/editions`, label: "Éditions", icon: "📋" },
    { href: `/services/${id}/stats`, label: "Statistiques", icon: "📈" },
    { href: `/services/${id}`, label: "Paramètres", icon: "🔧" },
  ];
}

function initialsOf(name: string, email: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  if (parts.length === 1 && parts[0]) return parts[0].slice(0, 2).toUpperCase();
  return (email[0] || "?").toUpperCase();
}

export function ConnectedShell({
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
  const [collapsed, setCollapsed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const serviceMatch = pathname.match(/^\/services\/([^/]+)/);
  const activeServiceId = serviceMatch ? serviceMatch[1] : null;
  const adminActive = !activeServiceId && pathname !== "/mon-compte";
  const tabs = activeServiceId ? serviceTabs(activeServiceId) : ADMIN_TABS;

  // Onglet actif = le href le plus long qui préfixe le chemin courant.
  let activeHref = "";
  for (const t of tabs) {
    if (
      (pathname === t.href || pathname.startsWith(`${t.href}/`)) &&
      t.href.length > activeHref.length
    ) {
      activeHref = t.href;
    }
  }

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
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
          <button type="button" className="user-pill" onClick={() => setMenuOpen((o) => !o)}>
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
            className={collapsed ? "collapsed" : ""}
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

            <div className="sidebar-label">Services</div>
            <div id="service-sidebar">
              {services.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={activeServiceId === s.id ? "active" : ""}
                  onClick={() => router.push(`/services/${s.id}/agenda`)}
                >
                  <span className="sb-icon">{s.icon || "📄"}</span>
                  <span className="sb-label">{s.label}</span>
                </button>
              ))}

              <button
                type="button"
                id="sidebar-admin-btn"
                className={`sidebar-admin-btn${adminActive ? " active" : ""}`}
                style={{ marginTop: ".6rem" }}
                onClick={() => router.push("/services")}
              >
                <span className="sb-icon">⚙️</span>
                <span className="sb-label">Administration</span>
              </button>

              <button
                type="button"
                className={`sidebar-compte-btn${pathname === "/mon-compte" ? " active" : ""}`}
                style={{ marginTop: ".3rem" }}
                onClick={() => router.push("/mon-compte")}
              >
                <span className="sb-icon">👤</span>
                <span className="sb-label">Mon compte</span>
              </button>
            </div>
          </div>

          <div className="app-main">
            <div className="tabs-nav">
              {tabs.map((t) => (
                <button
                  key={t.href}
                  type="button"
                  className={`tab-nav-btn${t.href === activeHref ? " active" : ""}`}
                  onClick={() => router.push(t.href)}
                >
                  <span className="tab-icon">{t.icon}</span> {t.label}
                </button>
              ))}
            </div>
            {children}
          </div>
        </div>
      </main>
    </>
  );
}
