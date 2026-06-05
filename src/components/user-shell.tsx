"use client";

import { ThemeToggle } from "@/components/theme-toggle";
import { signOut } from "@/lib/auth-client";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type ServiceItem = { id: string; label: string; icon: string | null };

function initialsOf(name: string, email: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  if (parts.length === 1 && parts[0]) return parts[0].slice(0, 2).toUpperCase();
  return (email[0] || "?").toUpperCase();
}

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
  const menuRef = useRef<HTMLDivElement>(null);

  const match = pathname.match(/^\/reservations\/([^/]+)/);
  const activeServiceId = match ? match[1] : null;

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
            </div>
          </div>

          <div className="app-main">{children}</div>
        </div>
      </main>
    </>
  );
}
