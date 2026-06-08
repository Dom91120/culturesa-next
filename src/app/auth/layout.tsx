import { ThemeToggle } from "@/components/theme-toggle";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header>
        <div className="logo">
          Cultu<em>Résa</em>
        </div>
        <div className="tagline">Réservation d&apos;activités culturelles</div>
        <div style={{ position: "absolute", top: "1rem", right: "1.5rem" }}>
          <ThemeToggle />
        </div>
      </header>
      <main>
        {/* Pages auth (sans sidebar) : on neutralise la hauteur 100dvh + le scroll
            interne de .app-main (hérités du shell connecté) pour éviter un 2e
            ascenseur — seule la page scrolle. */}
        <div className="app-layout" style={{ height: "auto" }}>
          <div className="app-main" style={{ height: "auto", overflowY: "visible" }}>
            <div className="tabs-nav">
              <button type="button" className="tab-nav-btn active">
                <span className="tab-icon">👤</span> Compte
              </button>
            </div>
            <div id="tab-content-compte">{children}</div>
          </div>
        </div>
      </main>
    </>
  );
}
