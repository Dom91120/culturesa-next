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
        <div style={{ width: "60%", maxWidth: 560, margin: "1.5rem auto", padding: "0 1rem" }}>
          {children}
        </div>
      </main>
    </>
  );
}
