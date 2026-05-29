import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CultuRésa — Réservation d'activités culturelles",
  description: "Système de réservation de créneaux culturels.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
