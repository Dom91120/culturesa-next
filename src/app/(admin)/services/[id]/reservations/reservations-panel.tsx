"use client";

import { useState, useTransition } from "react";
import { updateReservationSettingsAction } from "./actions";

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

const selectStyle: React.CSSProperties = {
  fontSize: ".85rem",
  padding: ".3rem .5rem",
  borderRadius: "var(--rad-sm)",
  border: "1px solid var(--border)",
  background: "var(--surface2)",
  color: "var(--text)",
};

const radioRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: ".4rem",
  fontSize: ".85rem",
  flexWrap: "wrap",
};

const numStyle: React.CSSProperties = {
  width: 56,
  fontSize: ".85rem",
  padding: ".2rem .35rem",
  borderRadius: "var(--rad-sm)",
  border: "1px solid var(--border)",
  background: "var(--surface2)",
  color: "var(--text)",
};

/** Pastille secondaire (titres des sections 2-4) — variante discrète. */
function SecondTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="panel-title panel-second-title"
      style={{ fontSize: ".82rem", color: "var(--muted)" }}
    >
      <span className="dot" style={{ background: "var(--warn)" }} />
      {children}
    </div>
  );
}

export function ReservationsPanel(props: Props) {
  const { serviceId } = props;
  const [maxReservations, setMaxReservations] = useState(props.maxReservations);
  const [maxReservationsPeriod, setMaxReservationsPeriod] = useState(props.maxReservationsPeriod);
  const [bookingDelay, setBookingDelay] = useState(props.bookingDelay);
  const [autoValidationDelay, setAutoValidationDelay] = useState(props.autoValidationDelay);
  const [validationBloquante, setValidationBloquante] = useState(props.validationBloquante);
  const [mgrMode, setMgrMode] = useState<NoticeMode>(
    (["hours", "daily", "weekly"].includes(props.mgrNoticeMode)
      ? props.mgrNoticeMode
      : "none") as NoticeMode,
  );
  const [mgrInterval, setMgrInterval] = useState(props.mgrNoticeIntervalHours);
  const [mgrHour, setMgrHour] = useState(props.mgrNoticeHour);
  const [mgrWeekday, setMgrWeekday] = useState(props.mgrNoticeWeekday);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /** Sauvegarde immédiate de l'état courant (avec d'éventuels overrides). */
  function save(overrides: Partial<Props> = {}) {
    setError(null);
    setSaved(false);
    const next = {
      serviceId,
      maxReservations,
      maxReservationsPeriod,
      bookingDelay,
      autoValidationDelay,
      validationBloquante,
      mgrNoticeMode: mgrMode,
      mgrNoticeIntervalHours: mgrInterval,
      mgrNoticeHour: mgrHour,
      mgrNoticeWeekday: mgrWeekday,
      ...overrides,
    };
    startTransition(async () => {
      const res = await updateReservationSettingsAction({
        id: serviceId,
        maxReservations: next.maxReservations,
        maxReservationsPeriod: next.maxReservationsPeriod,
        bookingDelay: next.bookingDelay,
        autoValidationDelay: next.autoValidationDelay,
        validationBloquante: next.validationBloquante,
        mgrNoticeMode: next.mgrNoticeMode as NoticeMode,
        mgrNoticeIntervalHours: next.mgrNoticeIntervalHours,
        mgrNoticeHour: next.mgrNoticeHour,
        mgrNoticeWeekday: next.mgrNoticeWeekday as
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
      <div className="panel-title">
        <span className="dot" style={{ background: "var(--warn)" }} />
        Nombre de réservations
      </div>

      <div
        style={{
          display: "flex",
          gap: "2.5rem",
          flexWrap: "wrap",
          marginBottom: ".5rem",
        }}
      >
        <Stepper
          label="Maximum par période"
          value={maxReservationsPeriod}
          onMinus={() => stepMaxPeriod(-1)}
          onPlus={() => stepMaxPeriod(1)}
          disabled={pending}
        />
        <Stepper
          label="Maximum par an"
          value={maxReservations}
          onMinus={() => stepMax(-1)}
          onPlus={() => stepMax(1)}
          disabled={pending}
        />
      </div>

      <SecondTitle>Délai de réservation</SecondTitle>
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: ".6rem",
          fontSize: ".85rem",
          flexWrap: "wrap",
        }}
      >
        Délai minimum avant une séance
        <select
          value={bookingDelay}
          disabled={pending}
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

      <SecondTitle>Validation bloquante</SecondTitle>
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: ".5rem",
          fontSize: ".85rem",
          cursor: "pointer",
          userSelect: "none",
        }}
      >
        Verrouillage des réservations validées
        <input
          type="checkbox"
          className="admin-cb"
          checked={validationBloquante}
          disabled={pending}
          onChange={(e) => {
            const v = e.target.checked;
            setValidationBloquante(v);
            save({ validationBloquante: v });
          }}
          style={{ accentColor: "var(--accent)", width: 14, height: 14 }}
        />
      </label>

      <SecondTitle>Auto-validation</SecondTitle>
      <label
        title="Les réservations en attente sont validées automatiquement après ce délai, sauf si la séance est déjà passée"
        style={{
          display: "flex",
          alignItems: "center",
          gap: ".6rem",
          fontSize: ".85rem",
          flexWrap: "wrap",
        }}
      >
        Auto-validation après
        <select
          value={autoValidationDelay}
          disabled={pending}
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

      <SecondTitle>Auto-validation — notification aux gestionnaires</SecondTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: ".4rem" }}>
        <label style={radioRow}>
          <input
            type="radio"
            name="mgr-notice"
            checked={mgrMode === "none"}
            disabled={pending}
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
            disabled={pending}
            onChange={() => {
              setMgrMode("hours");
              save({ mgrNoticeMode: "hours" });
            }}
            style={{ accentColor: "var(--accent)" }}
          />
          Toutes les
          <input
            type="number"
            min={1}
            max={168}
            value={mgrInterval}
            disabled={pending || mgrMode !== "hours"}
            onChange={(e) => {
              const v = Math.max(1, Math.min(168, Number(e.target.value) || 1));
              setMgrInterval(v);
              setMgrMode("hours");
              save({ mgrNoticeMode: "hours", mgrNoticeIntervalHours: v });
            }}
            style={numStyle}
          />
          heures
        </label>

        <label style={radioRow}>
          <input
            type="radio"
            name="mgr-notice"
            checked={mgrMode === "daily"}
            disabled={pending}
            onChange={() => {
              setMgrMode("daily");
              save({ mgrNoticeMode: "daily" });
            }}
            style={{ accentColor: "var(--accent)" }}
          />
          Quotidienne à
          <input
            type="number"
            min={0}
            max={23}
            value={mgrHour}
            disabled={pending || mgrMode !== "daily"}
            onChange={(e) => {
              const v = Math.max(0, Math.min(23, Number(e.target.value) || 0));
              setMgrHour(v);
              setMgrMode("daily");
              save({ mgrNoticeMode: "daily", mgrNoticeHour: v });
            }}
            style={numStyle}
          />
          h
        </label>

        <label style={radioRow}>
          <input
            type="radio"
            name="mgr-notice"
            checked={mgrMode === "weekly"}
            disabled={pending}
            onChange={() => {
              setMgrMode("weekly");
              save({ mgrNoticeMode: "weekly" });
            }}
            style={{ accentColor: "var(--accent)" }}
          />
          Hebdomadaire le
          <select
            value={mgrWeekday}
            disabled={pending || mgrMode !== "weekly"}
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
          <input
            type="number"
            min={0}
            max={23}
            value={mgrHour}
            disabled={pending || mgrMode !== "weekly"}
            onChange={(e) => {
              const v = Math.max(0, Math.min(23, Number(e.target.value) || 0));
              setMgrHour(v);
              setMgrMode("weekly");
              save({ mgrNoticeMode: "weekly", mgrNoticeHour: v });
            }}
            style={numStyle}
          />
          h
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
  disabled,
}: {
  label: string;
  value: number;
  onMinus: () => void;
  onPlus: () => void;
  disabled: boolean;
}) {
  const round: React.CSSProperties = {
    width: 22,
    height: 22,
    borderRadius: "50%",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    fontSize: "1rem",
    lineHeight: 1,
  };
  return (
    <div>
      <div style={{ fontSize: ".78rem", color: "var(--muted)", marginBottom: ".35rem" }}>
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: ".75rem" }}>
        <button
          type="button"
          className="btn btn-ghost"
          style={round}
          onClick={onMinus}
          disabled={disabled || value <= 1}
          aria-label={`${label} : diminuer`}
        >
          −
        </button>
        <span
          style={{
            fontSize: "1.6rem",
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
          disabled={disabled}
          aria-label={`${label} : augmenter`}
        >
          +
        </button>
      </div>
    </div>
  );
}
