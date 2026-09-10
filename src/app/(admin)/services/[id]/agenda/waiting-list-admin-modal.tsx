"use client";

import { useState, useTransition } from "react";
import { ModalOverlay, WaitingListGlyph } from "@/components/agenda-shared";
import type { WaitingAdminRow } from "@/server/services/waiting-list";
import { removeWaitingEntryAction } from "./actions";

/**
 * Liste d'attente du service (agenda gestionnaire) : inscrits dans l'ordre
 * d'inscription — usager, structure, disponibilités, inscription automatique, dates —
 * avec retrait d'une entrée. Les inscriptions elles-mêmes se font côté usager.
 */
export function WaitingListAdminModal({
  serviceId,
  rows,
  onClose,
  onChanged,
}: {
  serviceId: string;
  rows: WaitingAdminRow[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);

  function remove(id: number) {
    setError(null);
    setRemoving(id);
    startTransition(async () => {
      const res = await removeWaitingEntryAction(serviceId, id);
      setRemoving(null);
      if (!res.ok) setError(res.error ?? "Échec.");
      else onChanged();
    });
  }

  // En-têtes collants (le tableau défile sous eux) : le filet passe en ombre interne,
  // `border-collapse` ne conservant pas la bordure d'une cellule sticky.
  const th: React.CSSProperties = {
    position: "sticky",
    top: 0,
    zIndex: 1,
    background: "var(--surface)",
    boxShadow: "inset 0 -1px 0 var(--border)",
    textAlign: "left",
    padding: "3px 6px",
    fontSize: ".68rem",
    textTransform: "uppercase",
    letterSpacing: ".04em",
    color: "var(--muted)",
    whiteSpace: "nowrap",
  };
  const td: React.CSSProperties = {
    borderBottom: "1px solid var(--border)",
    padding: "5px 6px",
    fontSize: ".8rem",
    verticalAlign: "top",
  };
  const fmt = (iso: string) => new Date(iso).toLocaleDateString("fr-FR");

  return (
    <ModalOverlay
      onClose={onClose}
      labelledBy="waitlist-admin-title"
      // Boîte en colonne bornée à la hauteur visible : titre, description et en-têtes restent
      // fixes, seul le tableau défile (Dom 2026-09-10). Largeur élargie pour les disponibilités.
      boxStyle={{
        maxWidth: 980,
        maxHeight: "calc(100vh - 2rem)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <button type="button" className="modal-close" onClick={onClose} aria-label="Fermer">
        ×
      </button>
      <h3
        id="waitlist-admin-title"
        className="modal-title"
        style={{ display: "flex", alignItems: "center", gap: ".45rem", flexWrap: "nowrap" }}
      >
        {/* Même gris atténué que le pictogramme du bouton de la barre d'options. */}
        <span style={{ color: "var(--muted)", display: "inline-flex" }}>
          <WaitingListGlyph size={24} />
        </span>
        <span>
          Liste d'attente{" "}
          <span style={{ fontWeight: 400 }}>
            ({rows.length} inscrit{rows.length > 1 ? "s" : ""})
          </span>
        </span>
      </h3>
      <p
        style={{ fontSize: ".78rem", color: "var(--muted)", lineHeight: 1.5, margin: "0 0 .7rem" }}
      >
        Dans l'ordre d'inscription. Les inscrits sont prévenus par e-mail dès qu'un créneau
        réservable correspond à leurs disponibilités ; ceux qui l'ont demandé sont inscrits
        automatiquement. Toute réservation obtenue retire l'usager de la liste ; une inscription est
        close d'elle-même à la fin de ses périodes souhaitées (échéance).
      </p>
      {rows.length === 0 ? (
        <p style={{ fontSize: ".85rem", color: "var(--muted)" }}>Aucun inscrit.</p>
      ) : (
        <div className="wl-scroll" style={{ overflow: "auto", flex: "1 1 auto", minHeight: 0 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>#</th>
                <th style={th}>Usager</th>
                <th style={th}>Structure</th>
                <th style={{ ...th, minWidth: 240 }}>Disponibilités</th>
                <th style={{ ...th, textAlign: "center" }}>Auto</th>
                <th style={th}>Inscrit le</th>
                <th style={th}>Prévenu le</th>
                <th style={th}>Échéance</th>
                <th style={th} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id}>
                  <td style={{ ...td, color: "var(--muted)" }}>{i + 1}</td>
                  <td style={td}>
                    <div style={{ fontWeight: 600 }}>{`${r.nom} ${r.prenom}`.trim() || "—"}</div>
                    <div style={{ fontSize: ".72rem", color: "var(--muted)" }}>{r.email}</div>
                  </td>
                  <td style={td}>{r.structure || r.demandeur || "—"}</td>
                  <td style={td}>
                    {r.dispos.join(", ") || "—"}
                    {r.periodes.length > 0 && (
                      <div style={{ fontSize: ".72rem", color: "var(--muted)" }}>
                        Périodes : {r.periodes.join(", ")}
                      </div>
                    )}
                  </td>
                  <td style={{ ...td, textAlign: "center" }}>{r.autoInscription ? "Oui" : "—"}</td>
                  <td style={td}>{fmt(r.createdAt)}</td>
                  <td style={td}>{r.lastNotifiedAt ? fmt(r.lastNotifiedAt) : "—"}</td>
                  <td style={td}>
                    {r.echeance
                      ? new Date(`${r.echeance}T12:00:00`).toLocaleDateString("fr-FR")
                      : "—"}
                  </td>
                  <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: ".66rem", padding: ".2rem .5rem" }}
                      disabled={pending}
                      onClick={() => remove(r.id)}
                    >
                      {removing === r.id ? "Retrait…" : "Retirer"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {error && (
        <p className="field-error" style={{ display: "block" }}>
          {error}
        </p>
      )}
      <div className="btn-row">
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Fermer
        </button>
      </div>
    </ModalOverlay>
  );
}
