"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ONBOARDING_REPLAY_EVENT } from "@/components/onboarding-modal";
import { ThemeToggle } from "@/components/theme-toggle";
import { signOut } from "@/lib/auth-client";
import { initialsOf } from "@/lib/format";

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
  // Préférence sidebar repliée/étendue (clé PARTAGÉE avec le shell admin, persistée à
  // chaque bascule). État initial = déplié, comme le rendu serveur (pas de mismatch
  // d'hydratation) ; la restauration post-montage écrit .collapsed et les `title` dans
  // le DOM. Le visuel replié AVANT ce point est assuré par `html.sb-collapsed`, posée
  // par le script <head> de layout.tsx dès avant le premier paint (aucun « flash »).
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem("sidebar-collapsed") === "1") setCollapsed(true);
    } catch {}
  }, []);
  function toggleSidebar() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem("sidebar-collapsed", next ? "1" : "0");
    } catch {}
    // La classe html est synchronisée par l'effet sur l'état EFFECTIF (préférence
    // OU fenêtre étroite), plus bas.
  }
  // Menu « sandwich » des services en mode smartphone (replié par défaut).
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // Mode smartphone (même breakpoint que la media query CSS, 640px) : en mobile la sidebar
  // est une barre horizontale pleine largeur → l'état « collapsed » (toggle desktop) ne doit
  // JAMAIS s'y appliquer, même s'il a été activé avant de réduire la fenêtre.
  const [isMobile, setIsMobile] = useState(false);
  // Fenêtre ÉTROITE (≤ 1000px, hors mobile) : sidebar réduite D'OFFICE, indépendamment
  // de la préférence (le script <head> de layout.tsx couvre le pré-paint).
  const [narrow, setNarrow] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1000px)");
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // État EFFECTIF : préférence utilisateur OU fenêtre étroite — jamais en mobile.
  const effCollapsed = (collapsed || narrow) && !isMobile;

  // La classe html `sb-collapsed` (alias CSS pré-hydratation, cf. layout.tsx) suit
  // l'état effectif : retirée en mobile, posée en fenêtre étroite ou préférence repliée.
  useEffect(() => {
    try {
      document.documentElement.classList.toggle("sb-collapsed", effCollapsed);
    } catch {}
  }, [effCollapsed]);

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

      <main>
        <div className="app-layout">
          <div
            id="service-sidebar-wrap"
            className={`${effCollapsed ? "collapsed" : ""}${mobileNavOpen ? " mobile-open" : ""}`}
            style={{
              width: "16%",
              minWidth: "fit-content",
              maxWidth: 300,
              flexShrink: 0,
              position: "relative",
            }}
          >
            {/* Bascule masquée en fenêtre étroite : la réduction y est forcée. */}
            {!narrow && (
              <button
                type="button"
                id="sidebar-toggle"
                onClick={toggleSidebar}
                title="Réduire / agrandir"
              >
                ☰
              </button>
            )}
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

              {/* « Mon compte » en dernière position de la sidebar (comme le shell admin). */}
              <button
                type="button"
                className={`sidebar-compte-btn${pathname === "/mon-compte" ? " active" : ""}`}
                style={{ marginTop: ".6rem" }}
                title={effCollapsed ? "Mon compte" : undefined}
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
