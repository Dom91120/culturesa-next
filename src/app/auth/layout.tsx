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
        <div style={{ maxWidth: 760, margin: "0 auto", padding: "0 1rem 2rem" }}>
          <div className="tabs-nav">
            <button type="button" className="tab-nav-btn active">
              <span className="tab-icon">👤</span> Compte
            </button>
          </div>
          <div id="tab-content-compte">{children}</div>
        </div>
      </main>
    </>
  );
}
