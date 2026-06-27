// TypeScript 6 vérifie les imports d'effet de bord de modules non-JS. Les imports CSS
// (`import "./globals.css"`) sont gérés par Next.js au build : on les déclare ici pour
// satisfaire le compilateur (TS2882).
declare module "*.css";
