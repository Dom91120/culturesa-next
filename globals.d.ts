// Imports d'images statiques (`import iconPng from "@/app/icon.png"`) : leurs types
// viennent de `next/image-types/global`, référencé par `next-env.d.ts` — fichier GÉNÉRÉ
// et ignoré par git, donc ABSENT du runner de CI tant qu'aucun `next dev/build` n'a
// tourné. La CI échouait au typage (TS2307 sur icon.png) depuis la refonte de l'écran de
// connexion. La référence est posée ici, dans un fichier versionné, pour que `tsc` donne
// le même verdict partout. (Une directive `///` n'est reconnue qu'EN TÊTE de fichier.)
/// <reference types="next/image-types/global" />

// TypeScript 6 vérifie les imports d'effet de bord de modules non-JS. Les imports CSS
// (`import "./globals.css"`) sont gérés par Next.js au build : on les déclare ici pour
// satisfaire le compilateur (TS2882).
declare module "*.css";
