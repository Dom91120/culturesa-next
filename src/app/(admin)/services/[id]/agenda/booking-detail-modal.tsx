"use client";

import { useState, useTransition } from "react";
import { ModalOverlay } from "@/components/agenda-shared";
import { formatTel } from "@/lib/format";
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
 * - `canEdit` / `editBookingId` : l'édition des participants et du thème est découplée du
 *   mode consultation (`readOnly`). Pour une réservation RÉCURRENTE non validée, la fiche
 *   reste en consultation (actions de gestion masquées) mais les compteurs sont modifiables
 *   et l'enregistrement cible la réservation PARENTE (`editBookingId`), qui propage aux
 *   occurrences.
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
  canEdit,
  editBookingId,
  notice,
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
  // Participants + thème modifiables (indépendant de `readOnly`).
  canEdit: boolean;
  // Réservation cible de l'enregistrement (la PARENTE pour une occurrence récurrente).
  editBookingId: number;
  // Bandeau explicatif (portée récurrente, consultation…) — le verrou pointage prime.
  notice: string | null;
  onClose: () => void;
  onSaved: () => void;
  // Exécuteur d'action du parent (contrat { ok, error } : un échec affiche un toast).
  run: (p: Promise<{ ok: boolean; error?: string }>) => void;
}) {
  const [, startTransition] = useTransition();
  const [enfants, setEnfants] = useState(String(booking.enfants));
  const [accompagnants, setAccompagnants] = useState(String(booking.accompagnants));
  const [theme, setTheme] = useState(booking.theme);
  // Motif d'absence (en-tête) : saisi ici, enregistré au blur/Entrée via l'action de
  // pointage — n'existe que sur une occurrence pointée absente.
  const [motif, setMotif] = useState(booking.pointageMotif);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const locked = booking.pointage != null;
  // Édition effective des participants / du thème.
  const editable = canEdit && !locked;
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
    if (!dirty || !editable) return;
    setSaving(true);
    setError(null);
    startTransition(async () => {
      const res = await updateBookingDetailAction({
        bookingId: editBookingId,
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

  // Enregistre le motif d'absence s'il a changé (blur / Entrée). Passe par l'action
  // de pointage : « absent » + motif — le pointage est déjà absent, seul le motif bouge.
  function saveMotif() {
    const m = motif.trim();
    if (m === booking.pointageMotif.trim()) return;
    run(setBookingPointageAction(booking.id, serviceId, "absent", m));
  }

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
        {/* Cadenas : même prédicat que le verrou d'édition (réservation pointée). */}
        {locked && (
          <span
            title="Réservation pointée — édition verrouillée"
            aria-label="Édition verrouillée"
            style={{ fontSize: ".85rem" }}
          >
            🔒
          </span>
        )}
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
        {/* Pastille P/A inline (mêmes classes que les badges de la grille). */}
        {booking.pointage && (
          <span
            className={booking.pointage === "present" ? "indic_p" : "indic_a"}
            title={booking.pointage === "present" ? "Présent" : "Absent"}
          >
            {booking.pointage === "present" ? "P" : "A"}
          </span>
        )}
        {/* Motif d'absence : éditable en gestion, simple lecture en consultation. */}
        {booking.pointage === "absent" &&
          (readOnly ? (
            booking.pointageMotif.trim() !== "" && (
              <span style={{ fontSize: ".72rem", fontWeight: 500, color: "var(--muted)" }}>
                Motif : {booking.pointageMotif}
              </span>
            )
          ) : (
            <input
              value={motif}
              onChange={(e) => setMotif(e.target.value)}
              onBlur={saveMotif}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              maxLength={255}
              placeholder="Motif de l'absence…"
              aria-label="Motif de l'absence"
              style={{ fontSize: ".72rem", padding: ".2rem .45rem", flex: "1 1 160px" }}
            />
          ))}
      </div>

      {(locked || notice) && (
        <p style={{ fontSize: ".72rem", color: "var(--muted)", margin: ".2rem 0 .6rem" }}>
          {locked ? "Réservation pointée — édition verrouillée." : notice}
        </p>
      )}

      <div className="form-grid">
        {/* Champs en lecture seule : titre rendu en <span> (pas un <label>, qui doit être
            associé à un contrôle) — même style que le titre « Participants » plus bas.

            Ligne 1 — l'appartenance, en UN seul champ : la structure quand il y en a
            une (« École maternelle Arc-en-Ciel » dit déjà la catégorie), la catégorie
            seule sinon. Les afficher toutes deux répétait l'information sur deux
            lignes pour la majorité des fiches. */}
        <div className="field full">
          <span style={FIELD_TITLE_STYLE}>
            {booking.structure ? "Structure" : "Type de demandeur"}
          </span>
          <div className="bdet-readonly">{booking.structure || booking.demandeur || "—"}</div>
        </div>

        {/* Ligne 2 — qui réserve, et comment le joindre : les trois vont ensemble. */}
        <div className="field full bdet-row-3">
          <div>
            <span style={FIELD_TITLE_STYLE}>Demandeur</span>
            <div className="bdet-readonly">{booking.name || "—"}</div>
          </div>
          <div>
            <span style={FIELD_TITLE_STYLE}>Mail</span>
            <div className="bdet-readonly">{booking.email || "—"}</div>
          </div>
          <div>
            <span style={FIELD_TITLE_STYLE}>Tél</span>
            {/* Même présentation « 06 12 34 56 78 » que la liste des comptes : un numéro
                qu'on lit pour le composer se groupe par deux. `formatTel` rend déjà
                « — » sur une valeur vide. */}
            <div className="bdet-readonly">{formatTel(booking.tel)}</div>
          </div>
        </div>

        {/* Ligne 3 — niveau et participants : ce que le gestionnaire prépare. Le niveau
            tient sur un tiers (« CP », « Moyenne section ») ; les deux compteurs et
            leurs libellés occupent les deux tiers restants. */}
        <div className="field full bdet-row-niveau">
          <div>
            <span style={FIELD_TITLE_STYLE}>Niveau</span>
            <div className="bdet-readonly">{booking.niveau || "—"}</div>
          </div>
          <div>
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
                  disabled={!editable}
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
                  disabled={!editable}
                  onChange={(e) => setAccompagnants(e.target.value)}
                />
                <span className="pcm-counter-name">{plural(nAcc, "Adulte", "Adultes")}</span>
              </label>
            </div>
          </div>
        </div>
        {showTheme && (
          <div className="field full">
            <label htmlFor="bdet-theme">Thème</label>
            {themesMode === "liste" ? (
              <select
                id="bdet-theme"
                value={theme}
                disabled={!editable}
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
                disabled={!editable}
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

      {editable && (
        <div className="btn-row">
          {dirty && (
            <button type="button" className="btn btn-ghost" onClick={reset}>
              Annuler
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary"
            disabled={!dirty || saving}
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
