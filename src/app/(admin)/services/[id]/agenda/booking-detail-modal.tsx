"use client";

import { useState, useTransition } from "react";
import { ModalOverlay } from "@/components/agenda-shared";
import { formatTel } from "@/lib/format";
import { setBookingPointageAction, updateBookingDetailAction } from "./actions";
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
 * - Verrou : une réservation pointée n'est pas modifiable (édition désactivée) ; SEUL le
 *   motif d'absence reste saisissable (le pointage n'est pas gouverné par ce verrou).
 * - Boutons : uniquement ceux du FORMULAIRE (Enregistrer / Annuler / Supprimer, selon les
 *   droits). Valider/dévalider et pointer passent EXCLUSIVEMENT par les modes validation
 *   et pointage de la grille (décision Dom 2026-08-29 — plus de rangée d'actions ici).
 * - Champs : un champ modifiable garde le chrome input ; un champ figé est un aplat sans
 *   liseré (`.bdet-form` dans app-legacy.css).
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
  onDelete,
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
  // Ouvre la confirmation de suppression (le parent connaît la cible réelle : la
  // PARENTE pour une occurrence récurrente).
  onDelete: () => void;
}) {
  const [, startTransition] = useTransition();
  const [enfants, setEnfants] = useState(String(booking.enfants));
  const [accompagnants, setAccompagnants] = useState(String(booking.accompagnants));
  const [theme, setTheme] = useState(booking.theme);
  // Motif d'absence : champ du formulaire, enregistré par le bouton « Enregistrer »
  // comme les autres — n'existe que sur une occurrence pointée absente.
  const [motif, setMotif] = useState(booking.pointageMotif);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const locked = booking.pointage != null;
  // Édition effective des participants / du thème.
  const editable = canEdit && !locked;
  // Motif saisissable dès que la séance est absente : le pointage (et son motif) n'est
  // pas gouverné par le verrou — la fiche d'une occurrence pointée est justement en
  // consultation (readOnly), brancher sur readOnly le rendait insaisissable.
  const motifEditable = booking.pointage === "absent";
  // Suppression : action de gestion — jamais en consultation ni sur une résa
  // verrouillée par le pointage (mêmes règles que la croix des badges).
  const canDelete = !readOnly && !locked;
  // Le champ thème n'apparaît que si le service est en mode thèmes (liste) OU si la
  // réservation a déjà un thème non vide (rester fidèle au legacy sans le masquer à tort).
  const showTheme = themesMode === "liste" || booking.theme.trim() !== "";
  // En mode liste, on garantit que le thème courant figure dans les options.
  const themeOptions =
    themesMode === "liste" && theme && !themes.includes(theme) ? [theme, ...themes] : themes;

  const detailDirty =
    Number(enfants) !== booking.enfants ||
    Number(accompagnants) !== booking.accompagnants ||
    theme !== booking.theme;
  const motifDirty = motifEditable && motif.trim() !== booking.pointageMotif.trim();
  const dirty = (editable && detailDirty) || motifDirty;

  function reset() {
    setEnfants(String(booking.enfants));
    setAccompagnants(String(booking.accompagnants));
    setTheme(booking.theme);
    setMotif(booking.pointageMotif);
    setError(null);
  }

  // Enregistre ce qui a changé ET est modifiable : détail (participants/thème, sur la
  // cible d'édition) puis motif d'absence (sur l'occurrence, via l'action de pointage —
  // le pointage est déjà « absent », seul le motif bouge).
  function save() {
    if (!dirty) return;
    setSaving(true);
    setError(null);
    startTransition(async () => {
      if (editable && detailDirty) {
        const res = await updateBookingDetailAction({
          bookingId: editBookingId,
          serviceId,
          enfants: Number(enfants) || 0,
          accompagnants: Number(accompagnants) || 0,
          theme,
        });
        if (!res.ok) {
          setSaving(false);
          setError(res.error ?? "Échec.");
          return;
        }
      }
      if (motifDirty) {
        const res = await setBookingPointageAction(booking.id, serviceId, "absent", motif.trim());
        if (!res.ok) {
          setSaving(false);
          setError(res.error ?? "Échec.");
          return;
        }
      }
      setSaving(false);
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
        {/* Verrouillée : le cadenas REMPLACE le bloc-note (retour Dom 2026-08-29),
            en plus grand — c'est lui qui porte l'explication du verrou (l'ancienne
            ligne « Réservation pointée — édition verrouillée. » est supprimée). */}
        {/* Icône + libellé en inline-flex centré : l'émoji (corps 1.3rem) et le texte
            partagent le même axe vertical que le reste de la ligne (chip, date,
            pastille) — plus de vertical-align au jugé. */}
        <span style={{ display: "inline-flex", alignItems: "center", gap: ".3rem" }}>
          <span
            // Formulation « récurrente » réservée aux occurrences d'une récurrente :
            // une ponctuelle autonome pointée est verrouillée au même titre.
            title={
              locked
                ? booking.parentBookingId != null
                  ? "Réservation récurrente pointée : l'édition est verrouillée"
                  : "Réservation pointée : l'édition est verrouillée"
                : undefined
            }
            aria-label={locked ? "Édition verrouillée" : undefined}
            style={{ fontSize: "1.3rem", lineHeight: 1 }}
          >
            {locked ? "🔒" : "📋"}
          </span>
          <span>Réservation :</span>
        </span>
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
        {/* Pastille P/A inline — mêmes classes que les badges de la grille, doublée
            pour l'en-tête (la taille badge .52rem y est illisible). */}
        {booking.pointage && (
          <span
            className={booking.pointage === "present" ? "indic_p" : "indic_a"}
            title={booking.pointage === "present" ? "Présent" : "Absent"}
            style={{
              fontSize: "1rem",
              padding: "3px 6px",
              borderRadius: 6,
              display: "inline-flex",
              alignItems: "center",
              lineHeight: 1,
              // En bout de ligne, marge droite alignée OPTIQUEMENT sur la marge gauche
              // du cadenas : le glyphe émoji porte ~4px de blanc interne et un aplat
              // rouge réclame plus d'air qu'un glyphe — 8px au-delà du padding de la
              // boîte pour un rendu symétrique (mesuré/comparé, retour Dom 2026-08-29).
              // Écarte aussi la pastille du bouton × (2px de chevauchement à ras du bord).
              marginLeft: "auto",
              marginRight: 8,
            }}
          >
            {booking.pointage === "present" ? "P" : "A"}
          </span>
        )}
      </div>

      {/* La phrase « Réservation pointée — édition verrouillée. » est remplacée par le
          cadenas du titre (retour Dom 2026-08-29) ; seul le bandeau contextuel reste. */}
      {notice && (
        <p style={{ fontSize: ".72rem", color: "var(--muted)", margin: ".2rem 0 .6rem" }}>
          {notice}
        </p>
      )}

      {/* `.bdet-form` : distinction visuelle modifiable / figé (cf. app-legacy.css). */}
      <div className="form-grid bdet-form">
        {/* Motif d'absence : PREMIER champ de la fiche, uniquement quand la séance est
            pointée absente. Enregistré par le bouton « Enregistrer » (Entrée = raccourci). */}
        {motifEditable && (
          <div className="field full">
            <label htmlFor="bdet-motif" style={FIELD_TITLE_STYLE}>
              Motif de l'absence
            </label>
            <input
              id="bdet-motif"
              value={motif}
              onChange={(e) => setMotif(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
              }}
              maxLength={255}
            />
          </div>
        )}
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

      {/* Boutons du FORMULAIRE uniquement (valider/dévalider et pointer passent par les
          modes de la grille) : Supprimer à gauche selon les droits, Annuler/Enregistrer
          à droite dès qu'un champ de la fiche est modifiable. */}
      {(editable || motifEditable || canDelete) && (
        <div className="btn-row">
          {canDelete && (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ marginRight: "auto" }}
              onClick={onDelete}
            >
              🗑 Supprimer
            </button>
          )}
          {dirty && (
            <button type="button" className="btn btn-ghost" onClick={reset}>
              Annuler
            </button>
          )}
          {(editable || motifEditable) && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={!dirty || saving}
              onClick={save}
            >
              💾 Enregistrer
            </button>
          )}
        </div>
      )}
    </ModalOverlay>
  );
}
