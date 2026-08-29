"use client";

import { useMemo, useState } from "react";
import { INPUT_CHROME } from "@/components/ui-styles";
import { csvCell } from "@/lib/csv";

/** Entrée sérialisée pour le client (date déjà formatée côté serveur). */
export type JournalEntry = {
  id: number;
  dateLabel: string;
  action: string;
  actorLabel: string;
  actorRole: string;
  target: string | null;
  details: string | null;
  ip: string | null;
};

const PAGE_SIZE = 25;

// Libellés lisibles. Une action inconnue (ancienne entrée, ou clé ajoutée depuis)
// s'affiche telle quelle plutôt que de disparaître : un journal ne doit jamais
// masquer ce qu'il ne sait pas nommer.
const ACTION_LABELS: Record<string, string> = {
  "user.role_changed": "🔑 Changement de rôle",
  "user.created": "👤 Compte créé",
  "user.updated": "✏️ Compte modifié",
  "user.deleted": "🗑️ Compte supprimé",
  "user.password_reset_sent": "✉️ Lien de mot de passe envoyé",
  "user.two_factor_reset": "🔓 Double authentification réinitialisée",
  "user.affiliation_changed": "🏫 Catégorie / structure changée par l'usager",
  "backup.created": "💾 Sauvegarde créée",
  "backup.restored": "♻️ Base restaurée",
  "backup.deleted": "🗑️ Sauvegarde supprimée",
  "backup.downloaded": "⬇️ Sauvegarde téléchargée",
  "backup.uploaded": "⬆️ Sauvegarde téléversée",
  "config.mail_changed": "⚙️ Configuration SMTP modifiée",
  "service.deleted": "🗑️ Service supprimé",
};

/** Actions dont la portée justifie une mise en évidence visuelle. */
const CRITIQUES = new Set([
  "user.role_changed",
  "user.two_factor_reset",
  "backup.restored",
  "service.deleted",
]);

export function JournalTable({ entries }: { entries: JournalEntry[] }) {
  const [filtre, setFiltre] = useState("");
  const [page, setPage] = useState(0);

  const filtrees = useMemo(() => {
    const q = filtre.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) =>
      [e.action, ACTION_LABELS[e.action] ?? "", e.actorLabel, e.target ?? "", e.ip ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [entries, filtre]);

  const pages = Math.max(1, Math.ceil(filtrees.length / PAGE_SIZE));
  const courante = Math.min(page, pages - 1);
  const visibles = filtrees.slice(courante * PAGE_SIZE, (courante + 1) * PAGE_SIZE);

  function exporter() {
    const lignes = [
      ["Date", "Action", "Acteur", "Rôle", "Cible", "Détails", "IP"],
      ...filtrees.map((e) => [
        e.dateLabel,
        ACTION_LABELS[e.action] ?? e.action,
        e.actorLabel,
        e.actorRole,
        e.target ?? "",
        e.details ?? "",
        e.ip ?? "",
      ]),
    ];
    const body = lignes.map((c) => c.map(csvCell).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([`﻿${body}`], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "journal-audit.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="panel">
      <div className="panel-title">
        <span className="dot" />
        Journal des actions privilégiées
      </div>

      <div
        style={{
          display: "flex",
          gap: ".6rem",
          alignItems: "center",
          flexWrap: "wrap",
          marginBottom: ".75rem",
        }}
      >
        <input
          type="search"
          placeholder="Filtrer (action, acteur, cible, IP…)"
          value={filtre}
          onChange={(e) => {
            setFiltre(e.target.value);
            setPage(0);
          }}
          style={{ fontSize: ".8rem", padding: ".3rem .5rem", minWidth: 280, ...INPUT_CHROME }}
        />
        <span style={{ fontSize: ".75rem", color: "var(--muted)" }}>
          {filtrees.length} entrée{filtrees.length > 1 ? "s" : ""}
        </span>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={exporter}
          disabled={filtrees.length === 0}
          style={{ fontSize: ".75rem", padding: ".2rem .5rem" }}
        >
          Exporter en CSV
        </button>
      </div>

      {entries.length === 0 ? (
        <p style={{ fontSize: ".8rem", color: "var(--muted)", lineHeight: 1.6 }}>
          Aucune action privilégiée enregistrée pour l&apos;instant. Le journal se remplit lors des
          changements de rôle, des opérations sur les sauvegardes, des modifications de la
          configuration SMTP et des suppressions de service.
        </p>
      ) : (
        <>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".76rem" }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--muted)" }}>
                  <th style={{ padding: ".3rem .4rem" }}>Date</th>
                  <th style={{ padding: ".3rem .4rem" }}>Action</th>
                  <th style={{ padding: ".3rem .4rem" }}>Acteur</th>
                  <th style={{ padding: ".3rem .4rem" }}>Cible</th>
                  <th style={{ padding: ".3rem .4rem" }}>IP</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((e) => (
                  <tr key={e.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td
                      style={{
                        padding: ".3rem .4rem",
                        whiteSpace: "nowrap",
                        color: "var(--muted)",
                      }}
                    >
                      {e.dateLabel}
                    </td>
                    <td
                      style={{
                        padding: ".3rem .4rem",
                        fontWeight: CRITIQUES.has(e.action) ? 700 : 400,
                      }}
                      title={e.details ?? undefined}
                    >
                      {ACTION_LABELS[e.action] ?? e.action}
                      {e.details && (
                        <span style={{ color: "var(--muted)", fontWeight: 400 }}>
                          {" "}
                          — {e.details}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: ".3rem .4rem" }}>
                      {e.actorLabel}
                      {e.actorRole && (
                        <span style={{ color: "var(--muted)" }}> ({e.actorRole})</span>
                      )}
                    </td>
                    <td style={{ padding: ".3rem .4rem", fontFamily: "monospace" }}>
                      {e.target ?? "—"}
                    </td>
                    <td style={{ padding: ".3rem .4rem", color: "var(--muted)" }}>{e.ip ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pages > 1 && (
            <div
              style={{
                display: "flex",
                gap: ".5rem",
                alignItems: "center",
                justifyContent: "flex-end",
                marginTop: ".6rem",
                fontSize: ".75rem",
              }}
            >
              <button
                type="button"
                className="btn btn-ghost"
                disabled={courante === 0}
                onClick={() => setPage(courante - 1)}
                style={{ padding: ".15rem .45rem" }}
              >
                ←
              </button>
              <span style={{ color: "var(--muted)" }}>
                {courante + 1} / {pages}
              </span>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={courante >= pages - 1}
                onClick={() => setPage(courante + 1)}
                style={{ padding: ".15rem .45rem" }}
              >
                →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
