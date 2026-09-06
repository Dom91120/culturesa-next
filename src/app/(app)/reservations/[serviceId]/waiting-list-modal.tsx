"use client";

import { useEffect, useState } from "react";
import { ModalOverlay, WaitingListGlyph } from "@/components/agenda-shared";
import { DAY_NAMES } from "@/lib/agenda-core";
import { dispoKey, HALF_DAY_LABEL, HALF_DAYS } from "@/lib/waiting-list";
import { joinWaitingList, leaveWaitingList } from "./actions";

export type WaitingEntryView = {
  dispos: string[];
  // Périodes acceptées (ids) ; [] = toutes.
  periodIds: number[];
  autoInscription: boolean;
  createdAt: string; // ISO
};

export type WaitingPeriodOption = { id: number; label: string };

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
  periods,
  entry,
  preset,
  onClose,
  onSaved,
}: {
  serviceId: string;
  // Jours ouverts du service (clés lun..dim, ordre de la semaine).
  days: string[];
  // Périodes de l'exercice visible : le choix n'est proposé qu'à partir de deux
  // (toutes cochées par défaut — Dom 2026-09-06).
  periods: WaitingPeriodOption[];
  entry: WaitingEntryView | null;
  // Demi-journées précochées à l'ouverture (clic sur un créneau complet) — ignorées
  // si l'usager est déjà inscrit (ses disponibilités priment).
  preset?: string[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [dispos, setDispos] = useState<Set<string>>(new Set(entry?.dispos ?? preset ?? []));
  const periodChoice = periods.length > 1;
  const [periodIds, setPeriodIds] = useState<Set<number>>(
    new Set(entry && entry.periodIds.length > 0 ? entry.periodIds : periods.map((p) => p.id)),
  );
  const [auto, setAuto] = useState(entry?.autoInscription ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inscrit = entry != null;
  // Petit écran : jours ABRÉGÉS en en-tête (« Mer. ») et tableau sur toute la largeur —
  // cinq colonnes de « Mercredi » ne tiennent pas dans 375 px (Dom 2026-09-05).
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  const dayHeader = (d: string) => {
    const full = DAY_NAMES[d] ?? d;
    return narrow ? `${full.slice(0, 3)}.` : full;
  };

  function toggle(key: string) {
    setDispos((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function togglePeriod(id: number) {
    setPeriodIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit() {
    if (dispos.size === 0) {
      setError("Indiquez au moins une demi-journée de disponibilité.");
      return;
    }
    if (periodChoice && periodIds.size === 0) {
      setError("Indiquez au moins une période.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await joinWaitingList(serviceId, {
      dispos: [...dispos],
      // Toutes les périodes cochées = pas de restriction.
      periodIds: periodChoice && periodIds.size < periods.length ? [...periodIds] : [],
      autoInscription: auto,
    });
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
    // Modale élargie dès six périodes (services à périodes mensuelles) : six cases par
    // ligne, colonnes de largeur égale (Dom 2026-09-06).
    <ModalOverlay
      onClose={onClose}
      labelledBy="waitlist-title"
      boxStyle={{ maxWidth: periods.length >= 6 ? 640 : 520 }}
    >
      <button type="button" className="modal-close" onClick={onClose} aria-label="Fermer">
        ×
      </button>
      <h3
        id="waitlist-title"
        className="modal-title"
        style={{ display: "flex", alignItems: "center", gap: ".45rem", flexWrap: "nowrap" }}
      >
        {/* Même gris atténué que le pictogramme du bouton de la barre d'options. */}
        <span style={{ color: "var(--muted)", display: "inline-flex" }}>
          <WaitingListGlyph size={24} />
        </span>
        <span>S'inscrire sur la liste d'attente</span>
      </h3>

      <p style={{ fontSize: ".85rem", lineHeight: 1.55, margin: "0 0 .7rem" }}>
        Les séances qui vous intéressent sont complètes&nbsp;? Inscrivez-vous sur la liste d'attente
        du service en indiquant vos <strong>disponibilités par demi-journée</strong>.
      </p>

      {/* Jours en COLONNES, demi-journées en LIGNES (Dom 2026-09-05). */}
      <table
        style={{
          borderCollapse: "collapse",
          fontSize: ".82rem",
          margin: "0 auto .7rem",
          // Colonnes de jours de largeur ÉGALE (la plus large, « Mercredi », donne la mesure) ;
          // sur petit écran, toute la largeur avec les jours abrégés.
          tableLayout: "fixed",
          width: narrow ? "100%" : `calc(6.5rem + ${days.length} * 5.2rem)`,
          maxWidth: "100%",
        }}
      >
        <thead>
          <tr>
            <th
              style={{
                ...cell,
                textAlign: "left",
                fontWeight: 600,
                width: narrow ? "6.2rem" : "6.5rem",
              }}
            />
            {days.map((d) => (
              <th key={d} style={{ ...cell, fontWeight: 600 }}>
                {dayHeader(d)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {HALF_DAYS.map((h) => (
            <tr key={h}>
              <td style={{ ...cell, textAlign: "left", fontWeight: 600 }}>{HALF_DAY_LABEL[h]}</td>
              {days.map((d) => {
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

      <p style={{ fontSize: ".82rem", lineHeight: 1.55, margin: "0 0 .7rem" }}>
        Vous serez <strong>prévenu par e-mail</strong> dès que des créneaux correspondant à vos
        disponibilités se libéreront. La liste d'attente est traitée dans l'ordre d'inscription.
      </p>

      {periodChoice && (
        <div style={{ margin: "0 0 .7rem" }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: "1rem",
              margin: "0 0 .3rem",
            }}
          >
            <span style={{ fontSize: ".82rem", fontWeight: 600 }}>Périodes souhaitées</span>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ fontSize: ".68rem", padding: ".1rem .45rem" }}
              onClick={() =>
                setPeriodIds(
                  periodIds.size === periods.length ? new Set() : new Set(periods.map((p) => p.id)),
                )
              }
            >
              {periodIds.size === periods.length ? "Tout décocher" : "Tout cocher"}
            </button>
          </div>
          {/* Grille à colonnes ÉGALES : six par ligne au plus (petit écran : autant que la
              largeur le permet) — les mois s'alignent d'une ligne à l'autre. */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: narrow
                ? "repeat(auto-fill, minmax(6.5rem, 1fr))"
                : `repeat(${Math.min(6, periods.length)}, 1fr)`,
              gap: ".35rem .75rem",
            }}
          >
            {periods.map((p) => (
              <label
                key={p.id}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: ".4rem",
                  letterSpacing: 0,
                  textTransform: "none",
                  fontSize: ".85rem",
                  fontWeight: 500,
                  // Interligne 1 : un libellé replié (« Septembre - Décembre » en colonne
                  // étroite) reste compact (Dom 2026-09-06).
                  lineHeight: 1,
                  color: "var(--text)",
                  cursor: "pointer",
                  margin: 0,
                }}
              >
                <input
                  type="checkbox"
                  checked={periodIds.has(p.id)}
                  onChange={() => togglePeriod(p.id)}
                  style={{ width: 18, height: 18, flexShrink: 0 }}
                />
                {p.label}
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Option dans un CADRE discret (filet fin, fond de champ), pour la lire comme un
          choix à part du formulaire principal (Dom 2026-09-05). */}
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: "var(--rad-sm)",
          background: "var(--surface2)",
          padding: ".6rem .75rem",
          margin: "0 0 .35rem",
        }}
      >
        <div style={{ fontSize: ".82rem", fontWeight: 600, margin: "0 0 .35rem" }}>Option</div>
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
            margin: 0,
          }}
        >
          <input
            type="checkbox"
            checked={auto}
            onChange={(e) => setAuto(e.target.checked)}
            style={{ width: 18, height: 18, marginTop: 1, flexShrink: 0 }}
          />
          <span>
            Réservation automatique dès qu'un créneau se libère
            <span
              style={{
                display: "block",
                fontSize: ".74rem",
                fontWeight: 400,
                color: "var(--muted)",
                lineHeight: 1.45,
              }}
            >
              La réservation sera faite en votre nom, avec les participants de votre fiche, et vous
              en serez informé par e-mail.
            </span>
          </span>
        </label>
      </div>

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
