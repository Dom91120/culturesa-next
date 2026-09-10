"use client";

// Bloc « Validation & auto-validation » du panneau « Paramètres globaux du service ».
// Regroupe trois réglages service-globaux (Service.*) auparavant dans le panneau
// « Réservations » : verrouillage des réservations validées, auto-validation des demandes
// et fréquence de notification des gestionnaires. Auto-save débouncé (un seul appel
// serveur coalescé après une courte inactivité), non bloquant.

import { useEffect, useRef, useState, useTransition } from "react";
import { Switch } from "@/components/switch";
import { TimeStepper } from "@/components/time-stepper";
import { BellGlyph, ClockGlyph, LockGlyph } from "@/components/ui-glyphs";
import { updateServiceValidationSettingsAction } from "./actions";
import { GlobalRow } from "./global-row";

/** Heure entière (0-168) → « HH:00 » pour le TimeStepper. */
const hhmm = (n: number) => `${String(n).padStart(2, "0")}:00`;
/** « HH:MM » → heure entière bornée [lo, hi] (les minutes sont ignorées : pas de 1 h). */
const hourOf = (s: string, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, Number.parseInt(s, 10) || lo));

type NoticeMode = "none" | "each" | "hours" | "daily" | "weekly";

/** État d'enregistrement remonté au panneau (affiché dans la pastille du titre). */
export type SaveStatus = { pending: boolean; saved: boolean; error: string | null };

type Props = {
  serviceId: string;
  /** Remonte l'état d'auto-save au parent (pastille « Enregistré » du titre du panneau). */
  onStatus?: (s: SaveStatus) => void;
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
  { value: "lun", label: "lundi" },
  { value: "mar", label: "mardi" },
  { value: "mer", label: "mercredi" },
  { value: "jeu", label: "jeudi" },
  { value: "ven", label: "vendredi" },
  { value: "sam", label: "samedi" },
  { value: "dim", label: "dimanche" },
];

const AUTO_VALIDATION_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "Jamais" },
  { value: -1440, label: "1 jour ouvré" },
  { value: -2880, label: "2 jours ouvrés" },
  { value: -4320, label: "3 jours ouvrés" },
  { value: 10080, label: "1 semaine" },
  { value: 20160, label: "2 semaines" },
];

// Modes de notification, dans l'ordre des puces (mêmes puces que les filtres d'Échanges).
const NOTICE_MODES: { value: NoticeMode; label: string }[] = [
  { value: "none", label: "Aucune" },
  { value: "each", label: "Unitaire" },
  { value: "hours", label: "Toutes les n heures" },
  { value: "daily", label: "Quotidienne" },
  { value: "weekly", label: "Hebdomadaire" },
];

export function ServiceValidationSettings(props: Props) {
  const { serviceId } = props;
  const [validationBloquante, setValidationBloquante] = useState(props.validationBloquante);
  const [autoValidationDelay, setAutoValidationDelay] = useState(props.autoValidationDelay);
  // Mode de notification initial (résolu une fois ; partagé par l'état et la ref d'auto-save).
  const initialMgrMode = (
    ["each", "hours", "daily", "weekly"].includes(props.mgrNoticeMode)
      ? props.mgrNoticeMode
      : "none"
  ) as NoticeMode;
  const [mgrMode, setMgrMode] = useState<NoticeMode>(initialMgrMode);
  const [mgrInterval, setMgrInterval] = useState(props.mgrNoticeIntervalHours);
  const [mgrHour, setMgrHour] = useState(props.mgrNoticeHour);
  const [mgrWeekday, setMgrWeekday] = useState(props.mgrNoticeWeekday);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Autosave NON BLOQUANT : ne pas geler les contrôles pendant l'aller-retour serveur.
  const [pending, startTransition] = useTransition();
  // L'état d'enregistrement n'est pas affiché ici (un texte entre deux lignes ferait sauter
  // la mise en page) : il remonte au panneau, qui l'affiche dans la pastille du titre.
  const { onStatus } = props;
  useEffect(() => {
    onStatus?.({ pending, saved, error });
  }, [onStatus, pending, saved, error]);

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
        icon={
          <span className="rg-ico is-ok">
            <LockGlyph size={14} />
          </span>
        }
        label="Verrouillage des réservations validées"
        desc="Une fois validée, une réservation ne peut plus être annulée ni déplacée par l'usager."
      >
        <div className="cfg-ctl">
          <span className={`ms-pill ${validationBloquante ? "is-ok" : "is-neutral"}`}>
            {validationBloquante ? "activé" : "désactivé"}
          </span>
          <Switch
            on={validationBloquante}
            onChange={(v) => {
              setValidationBloquante(v);
              save({ validationBloquante: v });
            }}
          />
        </div>
      </GlobalRow>

      <GlobalRow
        icon={
          <span className="rg-ico is-ok">
            <ClockGlyph size={14} />
          </span>
        }
        label="Auto-validation des demandes"
        desc="Valide automatiquement les demandes en attente après ce délai, sauf si la séance est déjà passée."
      >
        <select
          className="cfg-select"
          value={autoValidationDelay}
          onChange={(e) => {
            const v = Number(e.target.value);
            setAutoValidationDelay(v);
            save({ autoValidationDelay: v });
          }}
        >
          {AUTO_VALIDATION_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </GlobalRow>

      {/* Notification des gestionnaires — puces (un mode = une puce, comme les filtres de
          l'onglet Échanges), puis une ligne de précision : phrase pour « Aucune » et
          « Unitaire », champs (intervalle, heure, jour) pour les modes planifiés. */}
      <GlobalRow
        icon={
          <span className="rg-ico is-warn">
            <BellGlyph size={14} />
          </span>
        }
        label="Notification des gestionnaires"
        desc="Fréquence de regroupement des e-mails envoyés aux gestionnaires."
      >
        <div
          className="cfg-ctl"
          style={{ flexDirection: "column", alignItems: "flex-end", gap: ".2rem" }}
        >
          <div className="cfg-chips">
            {NOTICE_MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                aria-pressed={mgrMode === m.value}
                className={`acct-chip${mgrMode === m.value ? " is-on" : ""}`}
                onClick={() => {
                  setMgrMode(m.value);
                  save({ mgrNoticeMode: m.value });
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div className="cfg-hint">
            {mgrMode === "none" && <span>Les gestionnaires ne reçoivent aucun e-mail.</span>}
            {mgrMode === "each" && <span>Chaque notification est envoyée sans attendre.</span>}
            {mgrMode === "hours" && (
              <>
                <span>Un récapitulatif toutes les</span>
                <TimeStepper
                  compact
                  value={hhmm(mgrInterval)}
                  step={60}
                  min={60}
                  max={168 * 60}
                  maxLength={6}
                  onChange={(v) => {
                    const h = hourOf(v, 1, 168);
                    setMgrInterval(h);
                    save({ mgrNoticeMode: "hours", mgrNoticeIntervalHours: h });
                  }}
                />
                <span>heures</span>
              </>
            )}
            {mgrMode === "daily" && (
              <>
                <span>Un récapitulatif chaque jour à</span>
                <TimeStepper
                  compact
                  value={hhmm(mgrHour)}
                  step={60}
                  min={0}
                  max={23 * 60}
                  onChange={(v) => {
                    const h = hourOf(v, 0, 23);
                    setMgrHour(h);
                    save({ mgrNoticeMode: "daily", mgrNoticeHour: h });
                  }}
                />
              </>
            )}
            {mgrMode === "weekly" && (
              <>
                <span>Un récapitulatif chaque</span>
                <select
                  className="cfg-select"
                  style={{ height: 18, fontSize: ".7rem" }}
                  value={mgrWeekday}
                  onChange={(e) => {
                    setMgrWeekday(e.target.value);
                    save({ mgrNoticeMode: "weekly", mgrNoticeWeekday: e.target.value });
                  }}
                >
                  {WEEKDAY_LABELS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
                <span>à</span>
                <TimeStepper
                  compact
                  value={hhmm(mgrHour)}
                  step={60}
                  min={0}
                  max={23 * 60}
                  onChange={(v) => {
                    const h = hourOf(v, 0, 23);
                    setMgrHour(h);
                    save({ mgrNoticeMode: "weekly", mgrNoticeHour: h });
                  }}
                />
              </>
            )}
          </div>
        </div>
      </GlobalRow>
    </>
  );
}
