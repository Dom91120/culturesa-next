import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Indispensable pour l'image Docker minimale (cf. Dockerfile / DEPLOY.md)
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  // svg-captcha (via opentype.js) charge sa police bundlée AU MOMENT DE L'IMPORT
  // avec un chemin relatif à son __dirname. S'il est empaqueté par webpack, le
  // fichier .ttf n'est pas copié → ENOENT. On le garde donc en require runtime
  // depuis node_modules, où la police est à côté du code.
  // + driver Postgres de Prisma 7 (pg : require dynamique) gardé hors bundle serveur.
  serverExternalPackages: ["svg-captcha", "@prisma/adapter-pg", "pg", "puppeteer"],
  // Pour le build standalone (Docker) : forcer l'inclusion de la police dans le
  // tracing, car le chemin construit dynamiquement échappe à l'analyse statique.
  outputFileTracingIncludes: {
    "/api/captcha": ["./node_modules/svg-captcha/fonts/**"],
  },
  // Indicateur Next.js de développement (le « rond N ») : affiché par défaut en dev
  // sous Next 15.5 ; seule la position reste configurable.
  devIndicators: {
    position: "bottom-right",
  },
  // En-têtes de sécurité posés PAR L'APP depuis le retrait de Caddy de la stack
  // (l'app peut être servie en direct). HSTS reste au reverse proxy TLS externe
  // (sans objet en HTTP) ; pas de CSP pour l'instant (inline scripts Next).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
  experimental: {
    // Server Actions : autorise les origines du domaine de prod
    serverActions: {
      // APP_DOMAIN peut lister plusieurs origines séparées par des virgules.
      allowedOrigins: process.env.APP_DOMAIN
        ? process.env.APP_DOMAIN.split(",")
            .map((o) => o.trim())
            .filter(Boolean)
        : undefined,
    },
  },
};

export default nextConfig;
