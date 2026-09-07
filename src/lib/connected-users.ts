// =====================================================================================
// « Utilisateurs connectés » (Administration › Utilisateurs › Connectés) : fonctions PURES.
// La validité d'une session est celle de la POLITIQUE APPLICATIVE (server/session-policy.ts,
// pure) : activité horodatée à la minute près (`session.updatedAt`), déconnexion automatique
// après MAX_IDLE (2 h usager, 15 min gestionnaire / administrateur) et plafond absolu
// (24 h / 8 h). Les lignes `session` encore en base mais hors politique sont donc ignorées :
// elles seraient révoquées à la prochaine requête. « Actif » = activité dans les 5 dernières
// minutes. Pas d'adresse IP (décision Dom 2026-09-07 : donnée personnelle sans usage ici).
// =====================================================================================

import type { Role } from "@/generated/prisma/client";
import { checkSessionPolicy } from "@/server/session-policy";

export type SessionRow = {
  userId: string;
  nom: string;
  prenom: string;
  email: string;
  role: string;
  createdAt: string; // ISO
  updatedAt: string; // ISO — dernière activité relevée
  userAgent: string | null;
};

export type ConnectedUser = {
  userId: string;
  nom: string;
  prenom: string;
  email: string;
  role: string;
  lastActivity: string; // ISO (max des updatedAt)
  since: string; // ISO (min des createdAt)
  sessions: number;
  devices: string[]; // libellés distincts (« Windows · Chrome »)
  active: boolean; // activité dans la fenêtre
};

export type ConnectedSummary = {
  users: ConnectedUser[];
  activeCount: number;
  sessionCount: number;
};

/** Fenêtre « actif » : une action dans les 5 dernières minutes. */
export const ACTIVE_WINDOW_MS = 5 * 60 * 1000;

/** La session est-elle encore valide au sens de la politique applicative ? */
export function isSessionValid(row: SessionRow, now: number): boolean {
  return (
    checkSessionPolicy(row.role as Role, new Date(row.updatedAt), new Date(row.createdAt), now) ===
    "ok"
  );
}

/** « Windows · Chrome », « iPhone · Safari »… depuis le navigateur déclaré ; « Inconnu » sinon. */
export function describeUserAgent(ua: string | null | undefined): string {
  const s = ua ?? "";
  if (!s.trim()) return "Inconnu";
  const os = /iPhone/.test(s)
    ? "iPhone"
    : /iPad/.test(s)
      ? "iPad"
      : /Android/.test(s)
        ? "Android"
        : /Windows/.test(s)
          ? "Windows"
          : /Mac OS X|Macintosh/.test(s)
            ? "macOS"
            : /CrOS/.test(s)
              ? "ChromeOS"
              : /Linux/.test(s)
                ? "Linux"
                : "";
  // Ordre important : Edge/Opera se déclarent aussi Chrome, Chrome se déclare aussi Safari.
  const browser = /Edg\//.test(s)
    ? "Edge"
    : /OPR\/|Opera/.test(s)
      ? "Opera"
      : /Firefox\//.test(s)
        ? "Firefox"
        : /Chrome\/|CriOS\//.test(s)
          ? "Chrome"
          : /Safari\//.test(s)
            ? "Safari"
            : "";
  const parts = [os, browser].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Inconnu";
}

/**
 * Regroupe les sessions VALIDES (politique applicative) par compte, du plus récemment
 * actif au plus ancien.
 */
export function summarizeSessions(allRows: SessionRow[], nowIso: string): ConnectedSummary {
  const now = new Date(nowIso).getTime();
  const rows = allRows.filter((r) => isSessionValid(r, now));
  const byUser = new Map<string, ConnectedUser>();
  for (const r of rows) {
    const device = describeUserAgent(r.userAgent);
    const cur = byUser.get(r.userId);
    if (!cur) {
      byUser.set(r.userId, {
        userId: r.userId,
        nom: r.nom,
        prenom: r.prenom,
        email: r.email,
        role: r.role,
        lastActivity: r.updatedAt,
        since: r.createdAt,
        sessions: 1,
        devices: [device],
        active: false,
      });
      continue;
    }
    cur.sessions += 1;
    if (r.updatedAt > cur.lastActivity) cur.lastActivity = r.updatedAt;
    if (r.createdAt < cur.since) cur.since = r.createdAt;
    if (!cur.devices.includes(device)) cur.devices.push(device);
  }
  const users = [...byUser.values()]
    .map((u) => ({ ...u, active: now - new Date(u.lastActivity).getTime() <= ACTIVE_WINDOW_MS }))
    .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
  return {
    users,
    activeCount: users.filter((u) => u.active).length,
    sessionCount: rows.length,
  };
}
