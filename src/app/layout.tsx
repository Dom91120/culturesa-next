import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./app-legacy.css";

export const metadata: Metadata = {
  title: "CultuRésa — Réservations",
  description: "Système de réservation de créneaux culturels.",
};

// Indispensable au mode smartphone : sans `width=device-width`, le téléphone rend la
// page à une largeur virtuelle (~980px), donc les media queries `max-width:640px` et
// le `matchMedia` JS (isMobile) ne se déclenchent jamais → on reste en layout desktop.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // `light` = mode clair par défaut (le CSS legacy bascule via html.light).
    <html lang="fr" className="light">
      <head>
        {/* Applique le thème sombre AVANT le premier paint (anti-FOUC) : sans ce script,
            un utilisateur en mode sombre voyait un flash clair tant que le useEffect de
            ThemeToggle n'avait pas retiré la classe. */}
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: script inline statique, sans donnée externe.
          dangerouslySetInnerHTML={{
            __html:
              "try{if(localStorage.getItem('theme')==='dark')document.documentElement.classList.remove('light');}catch(e){}",
          }}
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600&family=Barlow+Condensed:wght@400;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
