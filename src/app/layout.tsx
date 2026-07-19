import type { Metadata, Viewport } from "next";
import { Instrument_Sans } from "next/font/google";
import "./globals.css";
import "./app-legacy.css";

// Police AUTO-HÉBERGÉE via next/font (audit sécurité 2026-07-19) : téléchargée au build
// et servie depuis l'origine de l'app → plus de requête visiteur vers fonts.googleapis.com
// / fonts.gstatic.com (fuite d'IP, jurisprudence RGPD). Exposée en variable CSS, consommée
// par app-legacy.css. (« Barlow Condensed », chargée mais jamais utilisée, est supprimée.)
const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-instrument-sans",
});

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
    // suppressHydrationWarning : le script <head> ci-dessous MUTE les classes de <html>
    // avant l'hydratation (thème sombre, sidebar repliée) — divergence attendue avec le
    // rendu serveur, sans conséquence (même patron que next-themes).
    <html lang="fr" className={`light ${instrumentSans.variable}`} suppressHydrationWarning>
      <head>
        {/* Applique le thème sombre ET la sidebar repliée AVANT le premier paint
            (anti-FOUC) : sans ce script, un utilisateur en mode sombre voyait un flash
            clair, et une sidebar repliée mémorisée apparaissait dépliée le temps de
            l'hydratation. `sb-collapsed` (jamais en mobile : la sidebar y est une barre
            horizontale) est relayée par l'état React des shells après hydratation.
            Sous 1000px la sidebar est réduite D'OFFICE (même sans préférence). */}
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: script inline statique, sans donnée externe.
          dangerouslySetInnerHTML={{
            __html:
              "try{if(localStorage.getItem('theme')==='dark')document.documentElement.classList.remove('light');if(!matchMedia('(max-width: 640px)').matches&&(localStorage.getItem('sidebar-collapsed')==='1'||matchMedia('(max-width: 1000px)').matches))document.documentElement.classList.add('sb-collapsed');}catch(e){}",
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
