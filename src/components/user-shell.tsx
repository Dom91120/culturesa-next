"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import { signOut } from "@/lib/auth-client";

const TABS = [
  { href: "/reserver", label: "Réserver", icon: "📅" },
  { href: "/mes-reservations", label: "Mes réservations", icon: "🗂️" },
];

function initialsOf(name: string, email: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  if (parts.length === 1 && parts[0]) return parts[0].slice(0, 2).toUpperCase();
  return (email[0] || "?").toUpperCase();
}

export function UserShell({
  user,
  children,
}: {
  user: { name: string; email: string };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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
      <header>
        <div className="logo">
          Cultu<em>Résa</em>
        </div>
        <div className="tagline">Réservation d&apos;activités culturelles</div>
      </header>

      <div className="user-bar" id="user-bar">
        <div className="user-pill-wrap" ref={menuRef}>
          <div className="user-pill" onClick={() => setMenuOpen((o) => !o)}>
            <div className="avatar">{initialsOf(user.name, user.email)}</div>
            <span id="user-display-name" style={{ fontSize: ".78rem", color: "var(--text)" }}>
              {user.name || user.email}
            </span>
            <span style={{ fontSize: ".6rem", color: "var(--muted)" }}>▾</span>
          </div>
          <div id="user-menu" className={menuOpen ? "open" : ""}>
            <button type="button" className="danger" onClick={onLogout}>
              ⏏ Déconnexion
            </button>
          </div>
        </div>
        <ThemeToggle />
      </div>

      <main>
        <div className="app-layout" style={{ marginLeft: "auto", marginRight: "auto" }}>
          <div className="app-main">
            <div className="tabs-nav">
              {TABS.map((t) => {
                const active = pathname === t.href || pathname.startsWith(`${t.href}/`);
                return (
                  <Link
                    key={t.href}
                    href={t.href}
                    className={`tab-nav-btn${active ? " active" : ""}`}
                    style={{ textDecoration: "none" }}
                  >
                    <span className="tab-icon">{t.icon}</span> {t.label}
                  </Link>
                );
              })}
            </div>
            {children}
          </div>
        </div>
      </main>
    </>
  );
}
