import type { Metadata } from "next";
import "./globals.css";
import "./app-legacy.css";

export const metadata: Metadata = {
  title: "CultuRésa — Réservations",
  description: "Système de réservation de créneaux culturels.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // `light` = mode clair par défaut (le CSS legacy bascule via html.light).
    <html lang="fr" className="light">
      <head>
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
