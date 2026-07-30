"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ONBOARDING_REPLAY_EVENT } from "@/components/onboarding-modal";
import { ThemeToggle } from "@/components/theme-toggle";
import { signOut } from "@/lib/auth-client";
import { initialsOf } from "@/lib/format";

// ════════════════════════════════════════════════════════════
//  Briques PARTAGÉES des deux shells applicatifs (ConnectedShell admin/gestionnaire
//  et UserShell usager) — audit 2026-07-17 : la barre utilisateur, le style du
//  conteneur de sidebar, la marque et la bascule de repli étaient copiés à
//  l'identique, caractère pour caractère, dans les deux fichiers.
// ════════════════════════════════════════════════════════════

/**
 * Barre utilisateur (haut de page) : pilule avatar + menu (Mon compte, Revoir la
 * présentation, Guide, Déconnexion) + bascule de thème. Autonome : porte son état
 * d'ouverture, la fermeture au clic extérieur et la déconnexion.
 */
export function UserBar({ user }: { user: { name: string; email: string } }) {
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
          {/* Accès direct à l'enrôlement au second facteur (constat A6) : sans
              entrée de menu, la page ne serait atteignable que par la redirection
              du garde — donc invisible pour un usager qui souhaite l'activer de
              lui-même, et introuvable pour un gestionnaire déjà enrôlé. */}
          <button
            type="button"
            onClick={() => {
              router.push("/mon-compte/securite");
              setMenuOpen(false);
            }}
          >
            🔐 Sécurité
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
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              window.open("/aide/guide-utilisation.html", "_blank", "noopener");
            }}
          >
            📖 Guide d&apos;utilisation
          </button>
          <button type="button" className="danger" onClick={onLogout}>
            ⏏ Déconnexion
          </button>
        </div>
      </div>
      <ThemeToggle />
    </div>
  );
}

/** Style du conteneur de sidebar (#service-sidebar-wrap), commun aux deux shells. */
export const SIDEBAR_WRAP_STYLE: React.CSSProperties = {
  width: "16%",
  minWidth: "fit-content",
  maxWidth: 300,
  flexShrink: 0,
  position: "relative",
};

/** Marque « CultuRésa » + baseline, en tête de sidebar. */
export function SidebarBrand() {
  return (
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
  );
}

/** Bascule de repli de la sidebar — masquée en fenêtre étroite (réduction forcée). */
export function SidebarToggle({
  narrow,
  toggleSidebar,
}: {
  narrow: boolean;
  toggleSidebar: () => void;
}) {
  if (narrow) return null;
  return (
    <button type="button" id="sidebar-toggle" onClick={toggleSidebar} title="Réduire / agrandir">
      ☰
    </button>
  );
}
