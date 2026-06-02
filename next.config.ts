import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Indispensable pour l'image Docker minimale (cf. Dockerfile / DEPLOY.md)
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  // Indicateur Next.js de développement (le « rond N ») : affiché par défaut en dev
  // sous Next 15.5 ; seule la position reste configurable.
  devIndicators: {
    position: "bottom-right",
  },
  experimental: {
    // Server Actions : autorise les origines du domaine de prod
    serverActions: {
      allowedOrigins: process.env.APP_DOMAIN ? [process.env.APP_DOMAIN] : undefined,
    },
  },
};

export default nextConfig;
