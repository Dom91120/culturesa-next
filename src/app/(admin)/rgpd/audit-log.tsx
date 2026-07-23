"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { csvCell } from "@/lib/csv";

/** Personne (cible ou acteur) résolue côté serveur. */
export type AuditParty = {
  id: string;
  name: string;
  email: string;
  anonymized: boolean;
} | null;

/** Entrée de journal sérialisée pour le client. */
export type AuditEntry = {
  id: number;
  dateLabel: string;
  action: string;
  target: AuditParty;
  actor: AuditParty;
  ip: string | null;
};

const PAGE_SIZE = 10;

// Étiquette lisible (emoji) — port du legacy _rgpdActionLabel, complété des actions Next.
const ACTION_LABELS: Record<string, string> = {
  anonymize: "🗑️ Anonymisation",
  export: "📥 Export JSON",
  export_json: "📥 Export JSON",
  export_pdf: "🖨️ Export imprimable",
  self_delete_requested: "✉️ Demande de suppression",
  self_delete: "🗑️ Suppression self-service",
  notice_sent: "📧 Préavis d'inactivité",
  deletion_notice: "📧 Préavis d'inactivité",
  password_reset: "🔑 Mot de passe réinitialisé",
  password_reset_admin_trigger: "🔑 Lien reset envoyé par admin",
  hard_delete: "🗑️ Suppression dure (compte vide)",
};

function actionLabel(a: string): string {
  return ACTION_LABELS[a] ?? a;
}

/** Cellule cible/acteur : "Nom Prénom" + email dessous, ou "—" si vide. */
function PartyCell({ party, anonTag }: { party: AuditParty; anonTag: boolean }) {
  if (!party) return <span style={{ color: "var(--muted)" }}>—</span>;
  const label = party.name || party.email || `#${party.id}`;
  return (
    <span title={`user #${party.id}`}>
      {label}
      {anonTag && party.anonymized && (
        <span style={{ fontSize: ".62rem", color: "var(--muted)" }}> (anonymisé)</span>
      )}
      {party.name && party.email && (
        <>
          <br />
          <span style={{ fontSize: ".65rem", color: "var(--muted)" }}>{party.email}</span>
        </>
      )}
    </span>
  );
}

export function AuditLog({ entries }: { entries: AuditEntry[] }) {
  const router = useRouter();
  const [page, setPage] = useState(0);
  const [pending, startTransition] = useTransition();

  const total = entries.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(page, totalPages - 1);
  const from = current * PAGE_SIZE;
  const pageRows = entries.slice(from, from + PAGE_SIZE);

  function refresh() {
    startTransition(() => router.refresh());
  }

  function exportCsv() {
    const header = ["Date", "Action", "Cible", "Email cible", "Acteur", "Email acteur", "IP"];
    const lines = entries.map((e) =>
      [
        e.dateLabel,
        actionLabel(e.action),
        e.target?.name || e.target?.email || (e.target ? `#${e.target.id}` : ""),
        e.target?.email ?? "",
        e.actor?.name || e.actor?.email || (e.actor ? `#${e.actor.id}` : ""),
        e.actor?.email ?? "",
        e.ip ?? "",
      ]
        .map(csvCell)
        .join(";"),
    );
    // En-tête échappé comme les données ; séparateur « ; » + BOM (cohérent avec lib/csv).
    const csv = `﻿${[header.map(csvCell).join(";"), ...lines].join("\r\n")}`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "rgpd-audit.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ marginTop: "2rem" }}>
      <div className="panel-title" style={{ padding: ".3rem 0" }}>
        <span className="dot" style={{ background: "var(--warn)" }} />
        Journal d&apos;audit
      </div>
      <p
        style={{
          fontSize: ".78rem",
          color: "var(--muted)",
          marginBottom: "1rem",
          lineHeight: 1.5,
          textAlign: "justify",
        }}
      >
        Trace toutes les actions RGPD effectuées sur l&apos;application (anonymisations, exports,
        etc.). Cette journalisation est requise par le principe de redevabilité (RGPD art. 5.2) — ne
        contient pas de données nominatives.
      </p>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: ".5rem",
          flexWrap: "wrap",
          marginBottom: ".5rem",
        }}
      >
        <div style={{ marginLeft: "auto", display: "flex", gap: ".4rem" }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={refresh}
            disabled={pending}
            style={{ padding: ".15rem .55rem", fontSize: ".7rem" }}
          >
            🔄 Rafraîchir
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={exportCsv}
            disabled={total === 0}
            style={{ padding: ".15rem .55rem", fontSize: ".7rem" }}
          >
            📥 Export CSV
          </button>
        </div>
      </div>

      {total === 0 ? (
        <div
          style={{
            fontSize: ".78rem",
            color: "var(--muted)",
            fontStyle: "italic",
            padding: ".5rem",
          }}
        >
          Aucune action RGPD journalisée pour le moment.
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table zebra">
            <thead>
              <tr>
                <th style={{ textAlign: "center" }}>Date</th>
                <th style={{ textAlign: "center" }}>Action</th>
                <th style={{ textAlign: "center" }}>Cible</th>
                <th style={{ textAlign: "center" }}>Acteur</th>
                <th style={{ textAlign: "center" }}>IP</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((e) => (
                <tr key={e.id}>
                  <td style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>{e.dateLabel}</td>
                  <td>{actionLabel(e.action)}</td>
                  <td>
                    <PartyCell party={e.target} anonTag />
                  </td>
                  <td>
                    <PartyCell party={e.actor} anonTag={false} />
                  </td>
                  <td style={{ color: "var(--muted)", fontFamily: "monospace", fontSize: ".7rem" }}>
                    {e.ip || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > 0 && (
        <div style={{ display: "flex", alignItems: "center", marginTop: ".6rem" }}>
          <span style={{ flex: 1, fontSize: ".72rem", color: "var(--muted)" }}>
            {total} entrée{total > 1 ? "s" : ""}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ padding: ".1rem .45rem", fontSize: ".72rem" }}
              disabled={current === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              ‹
            </button>
            <span style={{ fontSize: ".7rem", color: "var(--muted)" }}>
              {current + 1} / {totalPages}
            </span>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ padding: ".1rem .45rem", fontSize: ".72rem" }}
              disabled={current >= totalPages - 1}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            >
              ›
            </button>
          </div>
          <span style={{ flex: 1 }} />
        </div>
      )}
    </div>
  );
}
