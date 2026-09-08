"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { Role } from "@/generated/prisma/client";
import type { ConnectedSummary } from "@/lib/connected-users";
import { ActionIconButton, Avatar, LogoutGlyph, RolePill } from "../account-ui";
import { disconnectUserAction } from "../actions";

/** « à l'instant », « il y a 12 min », « il y a 5 h », « hier 17:02 »… */
function relative(iso: string, nowMs: number): string {
  const t = new Date(iso).getTime();
  const min = Math.round((nowMs - t) / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  return new Date(iso).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function absolute(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Tableau des utilisateurs connectés (Dom 2026-09-07, style commun aux Comptes depuis le
 * 2026-09-08) : compteurs, un compte par ligne (avatar, pastille verte = action dans les
 * 5 dernières minutes, orange = session valide sans action récente ; les sessions hors
 * politique d'inactivité ne sont pas listées), bouton « Déconnecter » (révoque toutes les
 * sessions du compte, journalisé). Se rafraîchit toutes les 30 s. Pas d'adresse IP.
 */
export function ConnectedTable({
  summary,
  generatedAt,
  selfUserId,
}: {
  summary: ConnectedSummary;
  generatedAt: string;
  selfUserId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => new Date(generatedAt).getTime());

  useEffect(() => {
    setNowMs(new Date(generatedAt).getTime());
  }, [generatedAt]);
  useEffect(() => {
    const id = window.setInterval(() => router.refresh(), 30_000);
    return () => window.clearInterval(id);
  }, [router]);

  function disconnect(userId: string, label: string) {
    if (!window.confirm(`Déconnecter ${label} de tous ses appareils ?`)) return;
    setError(null);
    startTransition(async () => {
      const res = await disconnectUserAction(userId);
      if (!res?.ok) setError(res?.error ?? "Échec.");
      router.refresh();
    });
  }

  const kpi: React.CSSProperties = {
    flex: 1,
    minWidth: 140,
    background: "var(--surface1)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    padding: ".75rem 1rem",
  };

  return (
    <div className="panel">
      <div className="panel-title" style={{ justifyContent: "space-between", gap: ".75rem" }}>
        <span style={{ display: "flex", alignItems: "center", gap: ".6rem" }}>
          <span className="dot" />
          Utilisateurs connectés
        </span>
        <span style={{ fontSize: ".7rem", color: "var(--muted)", fontWeight: 400 }}>
          Relevé à {absolute(generatedAt)} — déconnexion automatique après 2 h sans action (usagers)
          ou 15 min (gestionnaires, administrateurs)
        </span>
      </div>

      <div style={{ display: "flex", gap: ".75rem", flexWrap: "wrap", margin: "0 0 1rem" }}>
        <div style={kpi}>
          <div style={{ fontSize: ".68rem", color: "var(--muted)" }}>Actifs (5 dernières min)</div>
          <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--accent)" }}>
            {summary.activeCount}
          </div>
        </div>
        <div style={kpi}>
          <div style={{ fontSize: ".68rem", color: "var(--muted)" }}>
            Comptes avec session ouverte
          </div>
          <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{summary.users.length}</div>
        </div>
        <div style={kpi}>
          <div style={{ fontSize: ".68rem", color: "var(--muted)" }}>Sessions ouvertes</div>
          <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{summary.sessionCount}</div>
        </div>
      </div>

      {error && (
        <p className="field-error" style={{ display: "block" }}>
          {error}
        </p>
      )}

      {summary.users.length === 0 ? (
        <p style={{ fontSize: ".82rem", color: "var(--muted)" }}>Aucune session ouverte.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="acct-table" style={{ minWidth: 720 }}>
            <colgroup>
              <col style={{ width: "34%" }} />
              <col style={{ width: 130 }} />
              <col style={{ width: "16%" }} />
              <col style={{ width: 120 }} />
              <col />
              <col style={{ width: 52 }} />
            </colgroup>
            <thead>
              <tr>
                <th>Compte</th>
                <th>Rôle</th>
                <th>Dernière action</th>
                <th>Connecté depuis</th>
                <th>Appareils</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {summary.users.map((u) => {
                const label = `${u.prenom} ${u.nom}`.trim() || u.email;
                const self = u.userId === selfUserId;
                const role = u.role as Role;
                return (
                  <tr key={u.userId}>
                    <td>
                      <div className="acct-who">
                        <Avatar prenom={u.prenom} nom={u.nom} email={u.email} role={role} />
                        <div style={{ minWidth: 0 }}>
                          <div className="name" style={{ display: "flex", alignItems: "center" }}>
                            <span
                              title={
                                u.active
                                  ? "Action dans les 5 dernières minutes"
                                  : "Session valide, sans action récente"
                              }
                              style={{
                                display: "inline-block",
                                width: 8,
                                height: 8,
                                borderRadius: "50%",
                                marginRight: 6,
                                flex: "0 0 auto",
                                background: u.active ? "var(--accent)" : "var(--warn)",
                              }}
                            />
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                              {label}
                            </span>
                            {self && (
                              <span
                                style={{
                                  marginLeft: 6,
                                  fontSize: ".68rem",
                                  color: "var(--muted)",
                                  fontWeight: 400,
                                }}
                              >
                                (vous)
                              </span>
                            )}
                          </div>
                          <div className="mail">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <RolePill role={role} />
                    </td>
                    <td title={absolute(u.lastActivity)}>{relative(u.lastActivity, nowMs)}</td>
                    <td>{absolute(u.since)}</td>
                    <td title={u.devices.join(", ")}>
                      {u.devices.join(", ")}
                      {u.sessions > 1 && (
                        <span style={{ color: "var(--muted)" }}> · {u.sessions} sessions</span>
                      )}
                    </td>
                    <td>
                      <div className="acct-actions">
                        <ActionIconButton
                          label={
                            self
                              ? "Utilisez « Se déconnecter » pour votre propre compte"
                              : `Déconnecter ${label} de tous ses appareils`
                          }
                          tone="danger"
                          disabled={pending || self}
                          onClick={() => disconnect(u.userId, label)}
                        >
                          <LogoutGlyph />
                        </ActionIconButton>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
