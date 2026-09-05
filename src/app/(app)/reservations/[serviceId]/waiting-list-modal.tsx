"use client";

import { useState } from "react";
import { ModalOverlay, WaitingListGlyph } from "@/components/agenda-shared";
import { DAY_NAMES } from "@/lib/agenda-core";
import { dispoKey, HALF_DAY_LABEL, HALF_DAYS } from "@/lib/waiting-list";
import { joinWaitingList, leaveWaitingList } from "./actions";

export type WaitingEntryView = {
  dispos: string[];
  autoInscription: boolean;
  createdAt: string; // ISO
};

/**
 * Modale « Liste d'attente » (agenda usager) : phrase d'introduction, grille des
 * disponibilités par demi-journée (jours ouverts du service × matin / après-midi),
 * explication de la notification par e-mail, case « M'inscrire automatiquement dès
 * qu'un créneau se libère », bouton « S'inscrire sur la liste d'attente » (spec Dom
 * 2026-09-05). Déjà inscrit : préremplie, « Mettre à jour » + « Me retirer de la liste ».
 */
export function WaitingListModal({
  serviceId,
  days,
  entry,
  onClose,
  onSaved,
}: {
  serviceId: string;
  // Jours ouverts du service (clés lun..dim, ordre de la semaine).
  days: string[];
  entry: WaitingEntryView | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [dispos, setDispos] = useState<Set<string>>(new Set(entry?.dispos ?? []));
  const [auto, setAuto] = useState(entry?.autoInscription ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inscrit = entry != null;

  function toggle(key: string) {
    setDispos((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function submit() {
    if (dispos.size === 0) {
      setError("Indiquez au moins une demi-journée de disponibilité.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await joinWaitingList(serviceId, { dispos: [...dispos], autoInscription: auto });
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "Échec.");
      return;
    }
    onSaved(
      inscrit
        ? "Vos disponibilités sont mises à jour."
        : "Vous êtes inscrit sur la liste d'attente : nous vous préviendrons par e-mail.",
    );
  }

  async function leave() {
    setBusy(true);
    setError(null);
    const res = await leaveWaitingList(serviceId);
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "Échec.");
      return;
    }
    onSaved("Vous êtes retiré de la liste d'attente.");
  }

  const cell: React.CSSProperties = { padding: ".3rem .5rem", textAlign: "center" };

  return (
    <ModalOverlay onClose={onClose} labelledBy="waitlist-title" boxStyle={{ maxWidth: 520 }}>
      <button type="button" className="modal-close" onClick={onClose} aria-label="Fermer">
        ×
      </button>
      <h3
        id="waitlist-title"
        className="modal-title"
        style={{ display: "flex", alignItems: "center", gap: ".45rem", flexWrap: "nowrap" }}
      >
        <WaitingListGlyph size={24} />
        <span>Liste d'attente</span>
      </h3>

      <p style={{ fontSize: ".85rem", lineHeight: 1.55, margin: "0 0 .7rem" }}>
        Les séances qui vous intéressent sont complètes&nbsp;? Inscrivez-vous sur la liste d'attente
        en indiquant vos <strong>disponibilités par demi-journée</strong>.
      </p>

      <table style={{ borderCollapse: "collapse", fontSize: ".82rem", margin: "0 auto .7rem" }}>
        <thead>
          <tr>
            <th style={{ ...cell, textAlign: "left", fontWeight: 600 }} />
            {HALF_DAYS.map((h) => (
              <th key={h} style={{ ...cell, fontWeight: 600, color: "var(--muted)" }}>
                {HALF_DAY_LABEL[h]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d}>
              <td style={{ ...cell, textAlign: "left", fontWeight: 600 }}>{DAY_NAMES[d] ?? d}</td>
              {HALF_DAYS.map((h) => {
                const k = dispoKey(d, h);
                return (
                  <td key={k} style={cell}>
                    <input
                      type="checkbox"
                      aria-label={`${DAY_NAMES[d] ?? d} ${HALF_DAY_LABEL[h].toLowerCase()}`}
                      checked={dispos.has(k)}
                      onChange={() => toggle(k)}
                      style={{ width: 18, height: 18, cursor: "pointer" }}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <p
        style={{ fontSize: ".82rem", lineHeight: 1.55, color: "var(--muted)", margin: "0 0 .7rem" }}
      >
        Vous serez <strong>prévenu par e-mail</strong> dès que des créneaux correspondant à vos
        disponibilités se libéreront. La liste d'attente est traitée dans l'ordre d'inscription.
      </p>

      <label
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: ".5rem",
          // Style global des <label> (capitales espacées) inadapté à une phrase.
          letterSpacing: 0,
          textTransform: "none",
          fontSize: ".85rem",
          fontWeight: 500,
          color: "var(--text)",
          cursor: "pointer",
          margin: "0 0 .35rem",
        }}
      >
        <input
          type="checkbox"
          checked={auto}
          onChange={(e) => setAuto(e.target.checked)}
          style={{ width: 18, height: 18, marginTop: 1, flexShrink: 0 }}
        />
        <span>
          M'inscrire automatiquement dès qu'un créneau se libère
          <span
            style={{
              display: "block",
              fontSize: ".74rem",
              fontWeight: 400,
              color: "var(--muted)",
              lineHeight: 1.45,
            }}
          >
            La réservation sera faite en votre nom, avec les participants de votre fiche, et vous en
            serez informé par e-mail.
          </span>
        </span>
      </label>

      {inscrit && entry && (
        <p style={{ fontSize: ".74rem", color: "var(--muted)", margin: ".4rem 0 0" }}>
          Inscrit depuis le {new Date(entry.createdAt).toLocaleDateString("fr-FR")}.
        </p>
      )}

      {error && (
        <p className="field-error" style={{ display: "block" }}>
          {error}
        </p>
      )}

      <div className="btn-row">
        {inscrit && (
          <button
            type="button"
            className="btn btn-ghost"
            style={{ marginRight: "auto" }}
            disabled={busy}
            onClick={leave}
          >
            Me retirer de la liste
          </button>
        )}
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
          {inscrit ? "Fermer" : "Annuler"}
        </button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={submit}>
          {inscrit ? "Mettre à jour" : "S'inscrire sur la liste d'attente"}
        </button>
      </div>
    </ModalOverlay>
  );
}
