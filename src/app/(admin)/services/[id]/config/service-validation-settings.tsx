"use client";

// Bloc « Validation & auto-validation » du panneau « Paramètres globaux du service ».
// Regroupe trois réglages service-globaux (Service.*) auparavant dans le panneau
// « Réservations » : verrouillage des réservations validées, auto-validation des demandes
// et fréquence de notification des gestionnaires. Auto-save débouncé (un seul appel
// serveur coalescé après une courte inactivité), non bloquant.

import { useEffect, useRef, useState, useTransition } from "react";
import { Switch } from "@/components/switch";
import { TimeStepper } from "@/components/time-stepper";
import { updateServiceValidationSettingsAction } from "./actions";
import { GlobalRow } from "./global-row";

/** Heure entière (0-168) → « HH:00 » pour le TimeStepper. */
const hhmm = (n: number) => `${String(n).padStart(2, "0")}:00`;
/** « HH:MM » → heure entière bornée [lo, hi] (les minutes sont ignorées : pas de 1 h). */
const hourOf = (s: string, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, Number.parseInt(s, 10) || lo));

type NoticeMode = "none" | "hours" | "daily" | "weekly";

type Props = {
  serviceId: string;
  validationBloquante: boolean;
  autoValidationDelay: number;
  mgrNoticeMode: string;
  mgrNoticeIntervalHours: number;
  mgrNoticeHour: number;
  mgrNoticeWeekday: string;
};

// Réglages persistés (sans serviceId) : accumulés dans une ref pour l'auto-save débouncé.
type Settings = {
  validationBloquante: boolean;
  autoValidationDelay: number;
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

const AUTO_VALIDATION_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "Jamais" },
  { value: -120, label: "2 heures ouvrées" },
  { value: -1440, label: "1 jour ouvré" },
  { value: -2880, label: "2 jours ouvrés" },
  { value: -4320, label: "3 jours ouvrés" },
  { value: 10080, label: "1 semaine" },
  { value: 20160, label: "2 semaines" },
];

// Champs (select + input heures) calés sur le style des inputs horaires du panneau Périodes.
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
  // Aligne le texte (« Toutes les », « Quotidienne à », « heures »…) et la valeur des
  // champs sur une même ligne de base, d'une ligne à l'autre.
  alignItems: "baseline",
  gap: ".4rem",
  fontSize: ".72rem",
  flexWrap: "wrap",
};

export function ServiceValidationSettings(props: Props) {
  const { serviceId } = props;
  const [validationBloquante, setValidationBloquante] = useState(props.validationBloquante);
  const [autoValidationDelay, setAutoValidationDelay] = useState(props.autoValidationDelay);
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
  // Autosave NON BLOQUANT : ne pas geler les contrôles pendant l'aller-retour serveur.
  const [, startTransition] = useTransition();

  // Auto-save DÉBOUNCÉ : chaque changement met à jour `settingsRef` (derniers réglages) et
  // (ré)arme un timer ; l'appel serveur n'a lieu qu'après une courte inactivité → un seul
  // appel coalescé (utile pour les flèches des champs heures).
  const settingsRef = useRef<Settings>({
    validationBloquante: props.validationBloquante,
    autoValidationDelay: props.autoValidationDelay,
    mgrNoticeMode: initialMgrMode,
    mgrNoticeIntervalHours: props.mgrNoticeIntervalHours,
    mgrNoticeHour: props.mgrNoticeHour,
    mgrNoticeWeekday: props.mgrNoticeWeekday,
  });
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Garde de démontage : save asynchrone + timer de succès → pas de setState après démontage.
  const mountedRef = useRef(true);
  const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      mountedRef.current = false;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (successTimer.current) clearTimeout(successTimer.current);
    },
    [],
  );

  /** Auto-save débouncé : applique les overrides du champ modifié, puis (ré)arme le timer. */
  function save(overrides: Partial<Settings> = {}) {
    setError(null);
    setSaved(false);
    settingsRef.current = { ...settingsRef.current, ...overrides };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const s = settingsRef.current;
      startTransition(async () => {
        const res = await updateServiceValidationSettingsAction({
          serviceId,
          validationBloquante: s.validationBloquante,
          autoValidationDelay: s.autoValidationDelay,
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
        if (!mountedRef.current) return;
        if (res?.ok) {
          setSaved(true);
          successTimer.current = setTimeout(() => {
            if (mountedRef.current) setSaved(false);
          }, 1800);
        } else {
          setError(res?.error ?? "Échec de l'enregistrement.");
        }
      });
    }, 700);
  }

  // (La notification des gestionnaires ne dépend PLUS de l'auto-validation : elle porte
  // aussi le récapitulatif des nouvelles réservations, qui a un objet même quand
  // l'auto-validation est sur « Jamais ». Le bloc reste donc toujours actif.)

  return (
    <>
      <GlobalRow
        label="Verrouillage des réservations validées"
        desc="Une fois validée, une réservation ne peut plus être annulée ni déplacée par l'usager."
      >
        <Switch
          on={validationBloquante}
          onChange={(v) => {
            setValidationBloquante(v);
            save({ validationBloquante: v });
          }}
        />
      </GlobalRow>

      <GlobalRow
        label="Auto-validation des demandes"
        desc="Valide automatiquement les demandes en attente après ce délai, sauf si la séance est déjà passée."
      >
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
      </GlobalRow>

      {/* Notification des gestionnaires — radios à droite, comme les contrôles au-dessus.
          Le libellé reste en haut (align start), mais la 1re option est descendue sur la
          « ligne de contrôle » — là où les Switch se centrent (≈ moitié de la ligne desc) —
          pour que « Aucune » soit à la même hauteur que les interrupteurs des rangées
          précédentes. */}
      <GlobalRow
        label="Notification des gestionnaires"
        desc="Fréquence de notification des gestionnaires."
        align="start"
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: ".45rem",
            paddingTop: ".5rem",
          }}
        >
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
              compact
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
              compact
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
              style={{ ...selectStyle, height: 17, fontSize: ".75rem" }}
            >
              {WEEKDAY_LABELS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
            à
            <TimeStepper
              compact
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
      </GlobalRow>

      {(error || saved) && (
        <div style={{ marginTop: ".6rem" }}>
          {error ? (
            <span className="field-error" style={{ display: "block" }}>
              {error}
            </span>
          ) : (
            <span style={{ fontSize: ".78rem", color: "var(--accent)" }}>✓ Enregistré</span>
          )}
        </div>
      )}
    </>
  );
}
