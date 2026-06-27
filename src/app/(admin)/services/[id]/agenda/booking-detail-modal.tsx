"use client";

import { useState, useTransition } from "react";
import { ModalOverlay } from "@/components/agenda-shared";
import {
  setBookingPointageAction,
  setBookingValidatedAction,
  updateBookingDetailAction,
} from "./actions";
import { plural } from "./agenda-format";
import type { Booking } from "./agenda-grid";
import { OccurrencesField } from "./occurrences-field";

// Titre d'un champ en lecture seule (≠ <label>, qui doit cibler un contrôle).
const FIELD_TITLE_STYLE: React.CSSProperties = {
  fontSize: ".65rem",
  fontWeight: 600,
  letterSpacing: ".1em",
  textTransform: "uppercase",
  color: "var(--muted)",
};

/**
 * Modale d'édition « 📋 Réservation » (port du legacy `#booking-detail-modal`).
 * - Demandeur en lecture seule.
 * - Participants : 2 compteurs (Enfants + Adultes/Accompagnants).
 * - Thème : champ libre (themesMode "libre") ou <select> (themesMode "liste").
 * - Verrou : une réservation pointée n'est pas modifiable (édition désactivée),
 *   mais les actions secondaires (pointage / suppression) restent accessibles.
 */
export function BookingDetailModal({
  booking,
  serviceId,
  themesMode,
  themes,
  periodTag,
  periodColor,
  dayHour,
  occurrenceDates,
  slotStart,
  slotEnd,
  readOnly,
  onClose,
  onSaved,
  run,
}: {
  booking: Booking;
  serviceId: string;
  themesMode: "libre" | "liste";
  themes: string[];
  periodTag: string;
  periodColor: string;
  dayHour: string;
  occurrenceDates: string[];
  slotStart: string;
  slotEnd: string;
  readOnly: boolean;
  onClose: () => void;
  onSaved: () => void;
  // Exécuteur d'action du parent (contrat { ok, error } : un échec affiche un toast).
  run: (p: Promise<{ ok: boolean; error?: string }>) => void;
}) {
  const [, startTransition] = useTransition();
  const [enfants, setEnfants] = useState(String(booking.enfants));
  const [accompagnants, setAccompagnants] = useState(String(booking.accompagnants));
  const [theme, setTheme] = useState(booking.theme);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const locked = booking.pointage != null;
  // Le champ thème n'apparaît que si le service est en mode thèmes (liste) OU si la
  // réservation a déjà un thème non vide (rester fidèle au legacy sans le masquer à tort).
  const showTheme = themesMode === "liste" || booking.theme.trim() !== "";
  // En mode liste, on garantit que le thème courant figure dans les options.
  const themeOptions =
    themesMode === "liste" && theme && !themes.includes(theme) ? [theme, ...themes] : themes;

  const dirty =
    Number(enfants) !== booking.enfants ||
    Number(accompagnants) !== booking.accompagnants ||
    theme !== booking.theme;

  function reset() {
    setEnfants(String(booking.enfants));
    setAccompagnants(String(booking.accompagnants));
    setTheme(booking.theme);
    setError(null);
  }

  function save() {
    if (!dirty || locked) return;
    setSaving(true);
    setError(null);
    startTransition(async () => {
      const res = await updateBookingDetailAction({
        bookingId: booking.id,
        serviceId,
        enfants: Number(enfants) || 0,
        accompagnants: Number(accompagnants) || 0,
        theme,
      });
      setSaving(false);
      if (!res.ok) {
        setError(res.error ?? "Échec.");
        return;
      }
      onSaved();
    });
  }

  const nEnf = Number(enfants) || 0;
  const nAcc = Number(accompagnants) || 0;

  return (
    <ModalOverlay onClose={onClose}>
      <button type="button" className="modal-close" onClick={onClose} aria-label="Fermer">
        ×
      </button>
      <div
        className="modal-title"
        style={{ display: "flex", alignItems: "center", gap: ".5rem", flexWrap: "wrap" }}
      >
        <span>📋 Réservation :</span>
        {periodTag && (
          <span
            className="period-btn active"
            style={{
              cursor: "default",
              padding: ".12rem .5rem",
              fontSize: ".64rem",
              gap: ".3rem",
              textTransform: "capitalize",
            }}
          >
            <span className="period-badge" style={{ display: "block", background: periodColor }} />
            {periodTag}
          </span>
        )}
        <span
          style={{
            fontSize: ".8rem",
            fontWeight: 500,
            color: "var(--muted)",
            textTransform: "capitalize",
          }}
        >
          {dayHour}
        </span>
      </div>

      {readOnly ? (
        <p style={{ fontSize: ".72rem", color: "var(--muted)", margin: ".2rem 0 .6rem" }}>
          Consultation — réservation récurrente (édition en vue « Modèle de période »).
        </p>
      ) : (
        locked && (
          <p style={{ fontSize: ".72rem", color: "var(--muted)", margin: ".2rem 0 .6rem" }}>
            Réservation pointée — édition verrouillée.
          </p>
        )
      )}

      <div className="form-grid">
        {/* Champs en lecture seule : titre rendu en <span> (pas un <label>, qui doit être
            associé à un contrôle) — même style que le titre « Participants » ci-dessous. */}
        <div className="field full">
          <span style={FIELD_TITLE_STYLE}>Type de demandeur</span>
          <div className="bdet-readonly">{booking.demandeur || "—"}</div>
        </div>
        {booking.structure && (
          <div className="field full">
            <span style={FIELD_TITLE_STYLE}>Structure</span>
            <div className="bdet-readonly">{booking.structure}</div>
          </div>
        )}
        <div className="field full">
          <span style={FIELD_TITLE_STYLE}>Demandeur</span>
          <div className="bdet-readonly">{booking.name || "—"}</div>
        </div>
        <div className="field full">
          <span style={FIELD_TITLE_STYLE}>Participants</span>
          <div className="pcm-counters">
            <label className="pcm-counter" htmlFor="bdet-enfants">
              <span className="pcm-counter-icon" aria-hidden="true">
                👶
              </span>
              <input
                id="bdet-enfants"
                type="number"
                min={0}
                max={99}
                value={enfants}
                disabled={locked || readOnly}
                onChange={(e) => setEnfants(e.target.value)}
              />
              <span className="pcm-counter-name">{plural(nEnf, "Enfant", "Enfants")}</span>
            </label>
            <label className="pcm-counter" htmlFor="bdet-accompagnants">
              <span className="pcm-counter-icon" aria-hidden="true">
                🧑‍🦰
              </span>
              <input
                id="bdet-accompagnants"
                type="number"
                min={0}
                max={99}
                value={accompagnants}
                disabled={locked || readOnly}
                onChange={(e) => setAccompagnants(e.target.value)}
              />
              <span className="pcm-counter-name">{plural(nAcc, "Adulte", "Adultes")}</span>
            </label>
          </div>
        </div>
        {showTheme && (
          <div className="field full">
            <label htmlFor="bdet-theme">Thème</label>
            {themesMode === "liste" ? (
              <select
                id="bdet-theme"
                value={theme}
                disabled={locked || readOnly}
                onChange={(e) => setTheme(e.target.value)}
              >
                <option value="">— aucun —</option>
                {themeOptions.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id="bdet-theme"
                value={theme}
                disabled={locked || readOnly}
                onChange={(e) => setTheme(e.target.value)}
                placeholder="(optionnel)"
              />
            )}
          </div>
        )}
        <OccurrencesField dates={occurrenceDates} startTime={slotStart} endTime={slotEnd} />
      </div>

      {error && (
        <p className="field-error" style={{ display: "block" }}>
          {error}
        </p>
      )}

      {!readOnly && (
        <div className="btn-row">
          {dirty && !locked && (
            <button type="button" className="btn btn-ghost" onClick={reset}>
              Annuler
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary"
            disabled={!dirty || locked || saving}
            onClick={save}
          >
            💾 Enregistrer
          </button>
        </div>
      )}

      {/* Actions secondaires — masquées en consultation (lecture seule). */}
      {!readOnly && (
        <div
          className="btn-row"
          style={{
            marginTop: ".75rem",
            paddingTop: ".6rem",
            borderTop: "1px solid var(--border)",
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: ".72rem" }}
            disabled={locked}
            onClick={() =>
              run(setBookingValidatedAction(booking.id, serviceId, !booking.validated))
            }
          >
            {booking.validated ? "↩ Dévalider" : "✓ Valider"}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: ".72rem" }}
            onClick={() => run(setBookingPointageAction(booking.id, serviceId, "present"))}
          >
            ✅ Présent
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: ".72rem" }}
            onClick={() => run(setBookingPointageAction(booking.id, serviceId, "absent"))}
          >
            ❌ Absent
          </button>
          {booking.pointage && (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ fontSize: ".72rem" }}
              onClick={() => run(setBookingPointageAction(booking.id, serviceId, null))}
            >
              ⚪ Effacer le pointage
            </button>
          )}
        </div>
      )}
    </ModalOverlay>
  );
}
