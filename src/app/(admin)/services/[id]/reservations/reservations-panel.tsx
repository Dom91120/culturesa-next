"use client";

import { TimeStepper } from "@/components/time-stepper";
import { useEffect, useRef, useState, useTransition } from "react";
import { updateReservationSettingsAction } from "./actions";

/** Heure entière (0-168) → « HH:00 » pour le TimeStepper. */
const hhmm = (n: number) => `${String(n).padStart(2, "0")}:00`;
/** « HH:MM » → heure entière bornée [lo, hi] (les minutes sont ignorées : pas de 1 h). */
const hourOf = (s: string, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, Number.parseInt(s, 10) || lo));

type NoticeMode = "none" | "hours" | "daily" | "weekly";

type Props = {
  serviceId: string;
  maxReservations: number;
  maxReservationsPeriod: number;
  bookingDelay: number;
  autoValidationDelay: number;
  validationBloquante: boolean;
  mgrNoticeMode: string;
  mgrNoticeIntervalHours: number;
  mgrNoticeHour: number;
  mgrNoticeWeekday: string;
};

// Réglages persistés (sans serviceId) : accumulés dans une ref pour l'auto-save débouncé.
type Settings = {
  maxReservations: number;
  maxReservationsPeriod: number;
  bookingDelay: number;
  autoValidationDelay: number;
  validationBloquante: boolean;
  mgrNoticeMode: string;
  mgrNoticeIntervalHours: number;
  mgrNoticeHour: number;
  mgrNoticeWeekday: string;
};

const WEEKDAY_LABELS: { value: string; label: string }[] = [
  { value: "lun", label: "Lundi" },
  { value: "mar", label: "Mardi" },
  { value: "mer", label: "Mercredi" },
  { value: "jeu", label: "Jeudi" },
  { value: "ven", label: "Vendredi" },
  { value: "sam", label: "Samedi" },
  { value: "dim", label: "Dimanche" },
];

const BOOKING_DELAY_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "Aucun délai" },
  { value: -1, label: "1 jour ouvré" },
  { value: -2, label: "2 jours ouvrés" },
  { value: -3, label: "3 jours ouvrés" },
  { value: 1007, label: "1 semaine" },
  { value: 1014, label: "2 semaines" },
  { value: 1021, label: "3 semaines" },
  { value: 1030, label: "1 mois" },
];

const AUTO_VALIDATION_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "Jamais" },
  { value: -120, label: "2 heures ouvrées" },
  { value: -1440, label: "1 jour ouvré" },
  { value: -2880, label: "2 jours ouvrés" },
  { value: -4320, label: "3 jours ouvrés" },
  { value: 10080, label: "1 semaine" },
  { value: 20160, label: "2 semaines" },
];

// Champs (select + input heures) calés sur le style des inputs horaires Matin/Après-midi
// (TimeStepper du panneau Périodes) : hauteur 21px, .78rem, mêmes bordure/fond/padding.
const selectStyle: React.CSSProperties = {
  height: 21,
  boxSizing: "border-box",
  fontSize: ".78rem",
  fontWeight: 400,
  padding: "0 .35rem",
  borderRadius: "var(--rad-sm)",
  border: "1px solid var(--border)",
  background: "var(--surface2)",
  color: "var(--text)",
};

const radioRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: ".4rem",
  fontSize: ".62rem",
  flexWrap: "wrap",
};

export function ReservationsPanel(props: Props) {
  const { serviceId } = props;
  const [maxReservations, setMaxReservations] = useState(props.maxReservations);
  const [maxReservationsPeriod, setMaxReservationsPeriod] = useState(props.maxReservationsPeriod);
  const [bookingDelay, setBookingDelay] = useState(props.bookingDelay);
  const [autoValidationDelay, setAutoValidationDelay] = useState(props.autoValidationDelay);
  const [validationBloquante, setValidationBloquante] = useState(props.validationBloquante);
  // Mode de notification initial (résolu une fois ; partagé par l'état et la ref d'auto-save).
  const initialMgrMode = (
    ["hours", "daily", "weekly"].includes(props.mgrNoticeMode) ? props.mgrNoticeMode : "none"
  ) as NoticeMode;
  const [mgrMode, setMgrMode] = useState<NoticeMode>(initialMgrMode);
  const [mgrInterval, setMgrInterval] = useState(props.mgrNoticeIntervalHours);
  const [mgrHour, setMgrHour] = useState(props.mgrNoticeHour);
  const [mgrWeekday, setMgrWeekday] = useState(props.mgrNoticeWeekday);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Pas de `pending` ici : l'autosave est NON BLOQUANT. Geler les contrôles (boutons ±, selects,
  // radios) pendant l'aller-retour serveur donnait une impression de lenteur/clics ignorés.
  const [, startTransition] = useTransition();

  // Auto-save DÉBOUNCÉ : chaque changement met à jour `settingsRef` (derniers réglages) et
  // (ré)arme un timer ; l'appel serveur n'a lieu qu'après une courte inactivité → un seul
  // appel coalescé au lieu d'un par clic/saisie (steppers, flèches des champs heures, etc.).
  const settingsRef = useRef<Settings>({
    maxReservations: props.maxReservations,
    maxReservationsPeriod: props.maxReservationsPeriod,
    bookingDelay: props.bookingDelay,
    autoValidationDelay: props.autoValidationDelay,
    validationBloquante: props.validationBloquante,
    mgrNoticeMode: initialMgrMode,
    mgrNoticeIntervalHours: props.mgrNoticeIntervalHours,
    mgrNoticeHour: props.mgrNoticeHour,
    mgrNoticeWeekday: props.mgrNoticeWeekday,
  });
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  /** Auto-save débouncé : applique les overrides du champ modifié à `settingsRef`, puis
   * (ré)arme le timer ; à son déclenchement, on envoie les DERNIERS réglages au serveur. */
  function save(overrides: Partial<Settings> = {}) {
    setError(null);
    setSaved(false);
    settingsRef.current = { ...settingsRef.current, ...overrides };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const s = settingsRef.current;
      startTransition(async () => {
        const res = await updateReservationSettingsAction({
          id: serviceId,
          maxReservations: s.maxReservations,
          maxReservationsPeriod: s.maxReservationsPeriod,
          bookingDelay: s.bookingDelay,
          autoValidationDelay: s.autoValidationDelay,
          validationBloquante: s.validationBloquante,
          mgrNoticeMode: s.mgrNoticeMode as NoticeMode,
          mgrNoticeIntervalHours: s.mgrNoticeIntervalHours,
          mgrNoticeHour: s.mgrNoticeHour,
          mgrNoticeWeekday: s.mgrNoticeWeekday as
            | "lun"
            | "mar"
            | "mer"
            | "jeu"
            | "ven"
            | "sam"
            | "dim",
        });
        if (res?.ok) {
          setSaved(true);
          window.setTimeout(() => setSaved(false), 1800);
        } else {
          setError(res?.error ?? "Échec de l'enregistrement.");
        }
      });
    }, 700);
  }

  function stepMax(delta: number) {
    const v = Math.max(1, maxReservations + delta);
    setMaxReservations(v);
    save({ maxReservations: v });
  }

  function stepMaxPeriod(delta: number) {
    const v = Math.max(1, maxReservationsPeriod + delta);
    setMaxReservationsPeriod(v);
    save({ maxReservationsPeriod: v });
  }

  return (
    <div className="panel">
      <div className="panel-title" style={{ marginBottom: ".75rem" }}>
        <span className="dot" style={{ background: "var(--warn)" }} />
        Réservations
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "max-content minmax(0, 1fr)",
          columnGap: "5rem",
          alignItems: "start",
          marginBottom: ".5rem",
        }}
      >
        {/* Groupe des deux compteurs « Maximum par période / par an ». */}
        <div>
          {/* Même style que le sous-titre « Auto-validation » (panel-subtitle, .85rem). */}
          <div
            className="panel-subtitle"
            style={{ fontSize: ".85rem", fontWeight: 500, margin: "0 0 0.6rem" }}
          >
            Maximums
          </div>
          <div style={{ display: "flex", gap: "2.5rem", flexWrap: "wrap" }}>
            <Stepper
              label="Maximum par période"
              value={maxReservationsPeriod}
              onMinus={() => stepMaxPeriod(-1)}
              onPlus={() => stepMaxPeriod(1)}
            />
            <Stepper
              label="Maximum par an"
              value={maxReservations}
              onMinus={() => stepMax(-1)}
              onPlus={() => stepMax(1)}
            />
          </div>
        </div>

        {/* Colonne de droite : délai avant réservation + verrouillage des résas validées. */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          {/* Même style que le sous-titre « Auto-validation » (panel-subtitle, .85rem). */}
          <div
            className="panel-subtitle"
            style={{ fontSize: ".85rem", fontWeight: 500, margin: "0 0 0.6rem" }}
          >
            Délais et verrou
          </div>
          {/* Délai de réservation + verrouillage regroupés. */}
          <div style={{ display: "flex", flexDirection: "column", gap: ".3rem" }}>
            <label
              title="Délai minimum avant une séance"
              style={{
                display: "flex",
                alignItems: "center",
                gap: ".6rem",
                fontSize: ".62rem",
                flexWrap: "wrap",
                // Hauteur d'un champ (21px) → les 2 lignes Délai / Verrou sont à la même hauteur.
                minHeight: 21,
              }}
            >
              Délai de réservation
              <select
                value={bookingDelay}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setBookingDelay(v);
                  save({ bookingDelay: v });
                }}
                style={selectStyle}
              >
                {BOOKING_DELAY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            <label
              title="Verrouille les réservations validées"
              style={{
                display: "flex",
                alignItems: "center",
                gap: ".5rem",
                fontSize: ".62rem",
                cursor: "pointer",
                userSelect: "none",
                // Hauteur d'un champ (21px) → les 2 lignes Délai / Verrou sont à la même hauteur.
                minHeight: 21,
              }}
            >
              <input
                type="checkbox"
                className="admin-cb"
                checked={validationBloquante}
                onChange={(e) => {
                  const v = e.target.checked;
                  setValidationBloquante(v);
                  save({ validationBloquante: v });
                }}
                style={{ accentColor: "var(--accent)", width: 14, height: 14 }}
              />
              Validation bloquante
            </label>
          </div>
        </div>
      </div>

      {/* Même style que le sous-titre « Périodes » (panel-subtitle, .85rem, léger gras). */}
      <div
        className="panel-subtitle"
        style={{ fontSize: ".85rem", fontWeight: 500, margin: "1.5rem 0 0.75rem" }}
      >
        Auto-validation
      </div>
      <label
        title="Les réservations en attente sont validées automatiquement après ce délai, sauf si la séance est déjà passée"
        style={{
          display: "flex",
          alignItems: "center",
          gap: ".6rem",
          fontSize: ".62rem",
          flexWrap: "wrap",
        }}
      >
        Auto-validation après
        <select
          value={autoValidationDelay}
          onChange={(e) => {
            const v = Number(e.target.value);
            setAutoValidationDelay(v);
            save({ autoValidationDelay: v });
          }}
          style={selectStyle}
        >
          {AUTO_VALIDATION_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      {/* Même style que le sous-titre « Périodes » (panel-subtitle, .85rem, léger gras). */}
      <div
        className="panel-subtitle"
        style={{ fontSize: ".85rem", fontWeight: 500, margin: "1.5rem 0 0.75rem" }}
      >
        Auto-validation : notification aux gestionnaires
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: ".4rem" }}>
        <label style={radioRow}>
          <input
            type="radio"
            name="mgr-notice"
            checked={mgrMode === "none"}
            onChange={() => {
              setMgrMode("none");
              save({ mgrNoticeMode: "none" });
            }}
            style={{ accentColor: "var(--accent)" }}
          />
          Aucune
        </label>

        <label style={radioRow}>
          <input
            type="radio"
            name="mgr-notice"
            checked={mgrMode === "hours"}
            onChange={() => {
              setMgrMode("hours");
              save({ mgrNoticeMode: "hours" });
            }}
            style={{ accentColor: "var(--accent)" }}
          />
          Toutes les
          <TimeStepper
            value={hhmm(mgrInterval)}
            step={60}
            min={60}
            max={168 * 60}
            maxLength={6}
            disabled={mgrMode !== "hours"}
            onChange={(v) => {
              const h = hourOf(v, 1, 168);
              setMgrInterval(h);
              setMgrMode("hours");
              save({ mgrNoticeMode: "hours", mgrNoticeIntervalHours: h });
            }}
          />
          heures
        </label>

        <label style={radioRow}>
          <input
            type="radio"
            name="mgr-notice"
            checked={mgrMode === "daily"}
            onChange={() => {
              setMgrMode("daily");
              save({ mgrNoticeMode: "daily" });
            }}
            style={{ accentColor: "var(--accent)" }}
          />
          Quotidienne à
          <TimeStepper
            value={hhmm(mgrHour)}
            step={60}
            min={0}
            max={23 * 60}
            disabled={mgrMode !== "daily"}
            onChange={(v) => {
              const h = hourOf(v, 0, 23);
              setMgrHour(h);
              setMgrMode("daily");
              save({ mgrNoticeMode: "daily", mgrNoticeHour: h });
            }}
          />
        </label>

        <label style={radioRow}>
          <input
            type="radio"
            name="mgr-notice"
            checked={mgrMode === "weekly"}
            onChange={() => {
              setMgrMode("weekly");
              save({ mgrNoticeMode: "weekly" });
            }}
            style={{ accentColor: "var(--accent)" }}
          />
          Hebdomadaire le
          <select
            value={mgrWeekday}
            disabled={mgrMode !== "weekly"}
            onChange={(e) => {
              setMgrWeekday(e.target.value);
              setMgrMode("weekly");
              save({ mgrNoticeMode: "weekly", mgrNoticeWeekday: e.target.value });
            }}
            style={selectStyle}
          >
            {WEEKDAY_LABELS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
          à
          <TimeStepper
            value={hhmm(mgrHour)}
            step={60}
            min={0}
            max={23 * 60}
            disabled={mgrMode !== "weekly"}
            onChange={(v) => {
              const h = hourOf(v, 0, 23);
              setMgrHour(h);
              setMgrMode("weekly");
              save({ mgrNoticeMode: "weekly", mgrNoticeHour: h });
            }}
          />
        </label>
      </div>

      <div style={{ minHeight: "1.4rem", marginTop: ".75rem" }}>
        {error ? (
          <span className="field-error" style={{ display: "block" }}>
            {error}
          </span>
        ) : saved ? (
          <span style={{ fontSize: ".78rem", color: "var(--accent)" }}>✓ Enregistré</span>
        ) : null}
      </div>
    </div>
  );
}

function Stepper({
  label,
  value,
  onMinus,
  onPlus,
}: {
  label: string;
  value: number;
  onMinus: () => void;
  onPlus: () => void;
}) {
  const round: React.CSSProperties = {
    width: 18,
    height: 18,
    borderRadius: "50%",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    fontSize: ".82rem",
    lineHeight: 1,
  };
  return (
    <div>
      <div
        style={{
          fontSize: ".78rem",
          color: "var(--muted)",
          marginBottom: ".3rem",
          textAlign: "center",
        }}
      >
        {label}
      </div>
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: ".5rem" }}
      >
        <button
          type="button"
          className="btn btn-ghost"
          style={round}
          onClick={onMinus}
          disabled={value <= 1}
          aria-label={`${label} : diminuer`}
        >
          −
        </button>
        <span
          style={{
            fontSize: "1rem",
            fontWeight: 700,
            color: "var(--warn)",
            minWidth: "1.5ch",
            textAlign: "center",
          }}
        >
          {value}
        </span>
        <button
          type="button"
          className="btn btn-ghost"
          style={round}
          onClick={onPlus}
          aria-label={`${label} : augmenter`}
        >
          +
        </button>
      </div>
    </div>
  );
}
