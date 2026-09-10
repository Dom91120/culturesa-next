"use client";

// Onglet « Configuration » : réglages globaux, matrice demandeurs et thèmes, TOUS en
// autosave débouncé (thèmes : suppression confirmée). Le récurrent et l'alternance Semaine A/B sont
// désormais toujours disponibles et se pilotent créneau par créneau dans l'agenda
// (bouton « Semaine A/B ») ; la matrice service × demandeur ne porte plus que
// validation/thèmes.
//
// Même famille graphique que les onglets Échanges et RGPD : un seul `.panel`, titre avec
// pictogramme `rg-ico`, groupes `ms-grp`, lignes `ex-krow`, pastilles `ms-pill`/`acct-pill`,
// pied `rg-foot`.

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ModalOverlay } from "@/components/agenda-shared";
import { Switch } from "@/components/switch";
import {
  AlertGlyph,
  CalendarTimeGlyph,
  CircleCheckGlyph,
  InfoGlyph,
  ListDetailsGlyph,
  SettingsGlyph,
} from "@/components/ui-glyphs";
import type { DemandeurSettingRow } from "@/server/services/demandeur-settings";
import { TrashGlyph, UsersGlyph } from "../../../users/account-ui";
import { saveDemandeurSettingsAction } from "../demandeurs/actions";
import { saveThemesAction } from "../themes/actions";
import {
  setAbsencePrevenueAction,
  setFullPeriodNoticeAction,
  setFullPeriodNoticeTextAction,
  setGaugeAccompagnantsAction,
  setListeAttenteAction,
} from "./actions";
import { GlobalRow } from "./global-row";
import { type SaveStatus, ServiceValidationSettings } from "./service-validation-settings";

// ── Types & helpers ──────────────────────────────────────────────────────────

type ThemeMode = "libre" | "liste";
type DemandeurOption = { id: number; label: string };
type DemRow = {
  key: string;
  demandeurId: number;
  validation: boolean;
  themes: boolean;
  themeRequired: boolean;
};
type ThemeRow = { key: string; label: string };

type Props = {
  serviceId: string;
  allDemandeurs: DemandeurOption[];
  initialRows: DemandeurSettingRow[];
  initialThemeMode: ThemeMode;
  initialThemes: string[];
  initialGaugeAccompagnants: boolean;
  initialFullPeriodNotice: boolean;
  initialFullPeriodNoticeText: string;
  // « Absences prévenues » : signalement d'absence à l'avance (usager + gestionnaire).
  initialAbsencePrevenue: boolean;
  // « Liste d'attente » : disponibilités des usagers, notification / inscription automatique.
  initialListeAttente: boolean;
  // Réglages « Validation & auto-validation » (service-globaux), édités ici.
  validationBloquante: boolean;
  autoValidationDelay: number;
  mgrNoticeMode: string;
  mgrNoticeIntervalHours: number;
  mgrNoticeHour: number;
  mgrNoticeWeekday: string;
};

/** Reprojette l'état par-demandeur vers la matrice service × demandeur.
 *  (Jauge → par créneau ; récurrent/A/B → globaux du service.) */
function buildMatrix(rows: DemRow[]): DemandeurSettingRow[] {
  return rows
    .filter((r) => r.demandeurId > 0)
    .map((r) => ({
      demandeurId: r.demandeurId,
      validation: r.validation,
      themes: r.themes,
      themeRequired: r.themeRequired,
    }));
}

/** Signature stable (triée) d'une matrice, pour détecter un vrai changement. */
function matrixSig(m: DemandeurSettingRow[]): string {
  return JSON.stringify([...m].sort((a, b) => a.demandeurId - b.demandeurId));
}

/** Nettoyage des libellés de thèmes (trim, vides, dédoublonnage casse-insensible). */
function cleanLabels(labels: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of labels) {
    const label = raw.trim();
    if (label === "") continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

/** Initiales d'un libellé de structure (« Ecole maternelle » → « EM »), pour l'avatar. */
function labelInitials(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean);
  const a = words[0]?.[0] ?? "";
  const b = words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : (words[0]?.[1] ?? "");
  return (a + b).toUpperCase();
}

// ── Panneau ──────────────────────────────────────────────────────────────────

/** Pastille d'état + interrupteur, pour les lignes des Paramètres globaux. */
function StateSwitch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="cfg-ctl">
      <span className={`ms-pill ${on ? "is-ok" : "is-neutral"}`}>
        {on ? "activé" : "désactivé"}
      </span>
      <Switch on={on} onChange={onChange} />
    </div>
  );
}

// Bouton de barre d'outils de groupe (même style que « ＋ Ajouter un type » d'Échanges).
const headBtn: React.CSSProperties = {
  padding: ".18rem .55rem",
  fontSize: ".66rem",
  display: "inline-flex",
  alignItems: "center",
  gap: ".35rem",
};

/** Compléments de style scopés (préfixe cfg-) au vocabulaire Échanges/RGPD. */
const CFG_CSS = `
.cfg-row{grid-template-columns:28px minmax(0,1fr) auto;padding:.45rem .5rem}
.cfg-kds{font-size:.68rem;color:var(--muted);line-height:1.35;margin-top:1px;max-width:640px;text-wrap:pretty}
.cfg-below{grid-column:2 / -1;min-width:0}
.cfg-ctl{display:flex;align-items:center;gap:.5rem;justify-self:end}
.cfg-chips{display:flex;flex-wrap:wrap;gap:.3rem;justify-content:flex-end}
.cfg-hint{display:flex;align-items:baseline;gap:.35rem;font-size:.7rem;color:var(--muted);flex-wrap:wrap;justify-content:flex-end;min-height:18px;line-height:1.3}
.cfg-select{height:22px;box-sizing:border-box;font-size:.74rem;font-weight:400;padding:0 .35rem;border-radius:var(--rad-sm);border:1px solid var(--border);background:var(--surface1);color:var(--text)}
.cfg-textarea{width:100%;max-width:640px;min-height:70px;resize:vertical;font-size:.76rem;line-height:1.4;padding:.4rem .5rem;border-radius:var(--rad-sm);border:1px solid var(--border);background:var(--surface1);color:var(--text)}
.cfg-dhead,.cfg-drow{display:grid;grid-template-columns:28px minmax(0,1fr) 90px 90px 120px 28px;gap:.6rem;align-items:center}
.cfg-grp{margin:1.6rem 0 .9rem;color:var(--text)}
.cfg-grp .hint{color:var(--muted)}
.cfg-grp-right{margin-left:.6rem;order:1;display:inline-flex;align-items:center;gap:.3rem}
.cfg-dhead{padding:.3rem 0;margin:0 .5rem;border-bottom:1px solid var(--border);font-size:.66rem;font-weight:600;color:var(--muted)}
.cfg-dhead span:nth-child(3),.cfg-dhead span:nth-child(4),.cfg-dhead span:nth-child(5){text-align:center}
.cfg-drow{padding:.35rem .5rem;border-radius:8px;font-size:.78rem}
.cfg-drow:hover,.cfg-trow:hover{background:color-mix(in srgb,var(--text) 4%,transparent)}
.cfg-drow:hover .ms-acts,.cfg-trow:hover .ms-acts{opacity:1}
.cfg-c{display:flex;justify-content:center}
.cfg-trow{display:grid;grid-template-columns:28px minmax(0,1fr) auto;gap:.6rem;align-items:center;padding:.35rem .5rem;border-radius:8px;font-size:.78rem}
.cfg-trow input{width:100%;box-sizing:border-box;font:inherit;font-size:.78rem;font-weight:600;padding:.1rem .4rem;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--text);outline:none;box-shadow:none}
.cfg-trow input:hover{border-color:var(--border)}
.cfg-trow input:focus{border-color:var(--accent);background:var(--surface1);box-shadow:none}
.cfg-num{width:24px;height:24px;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;font-size:.66rem;font-weight:700;background:color-mix(in srgb,var(--slot-uniq-color) 18%,transparent);color:var(--slot-uniq-color)}
`;

export function ConfigPanel({
  serviceId,
  allDemandeurs,
  initialRows,
  initialThemeMode,
  initialThemes,
  initialGaugeAccompagnants,
  initialFullPeriodNotice,
  initialFullPeriodNoticeText,
  initialAbsencePrevenue,
  initialListeAttente,
  validationBloquante,
  autoValidationDelay,
  mgrNoticeMode,
  mgrNoticeIntervalHours,
  mgrNoticeHour,
  mgrNoticeWeekday,
}: Props) {
  const counter = useRef(0);

  // Réglages service-globaux (Service.*) : persistance immédiate, dédiée,
  // indépendante de la matrice demandeurs.
  const [gaugeAccompagnants, setGaugeAccompagnants] = useState(initialGaugeAccompagnants);
  const [, startGaugeAcc] = useTransition();
  function toggleGaugeAccompagnants(v: boolean) {
    setGaugeAccompagnants(v);
    startGaugeAcc(async () => {
      await setGaugeAccompagnantsAction(serviceId, v);
    });
  }
  const [absencePrevenue, setAbsencePrevenue] = useState(initialAbsencePrevenue);
  const [, startAbsencePrevenue] = useTransition();
  function toggleAbsencePrevenue(v: boolean) {
    setAbsencePrevenue(v);
    startAbsencePrevenue(async () => {
      await setAbsencePrevenueAction(serviceId, v);
    });
  }
  const [listeAttente, setListeAttente] = useState(initialListeAttente);
  const [, startListeAttente] = useTransition();
  function toggleListeAttente(v: boolean) {
    setListeAttente(v);
    startListeAttente(async () => {
      await setListeAttenteAction(serviceId, v);
    });
  }
  const [fullPeriodNotice, setFullPeriodNotice] = useState(initialFullPeriodNotice);
  const [, startFullNotice] = useTransition();
  function toggleFullPeriodNotice(v: boolean) {
    setFullPeriodNotice(v);
    startFullNotice(async () => {
      await setFullPeriodNoticeAction(serviceId, v);
    });
  }
  // Texte personnalisé de l'alerte : auto-save DÉBOUNCÉ (saisie au clavier — un appel
  // serveur coalescé après une courte inactivité, comme ServiceValidationSettings).
  const [fullNoticeText, setFullNoticeText] = useState(initialFullPeriodNoticeText);
  const fullNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, startFullNoticeText] = useTransition();
  function changeFullNoticeText(v: string) {
    setFullNoticeText(v);
    if (fullNoticeTimer.current) clearTimeout(fullNoticeTimer.current);
    fullNoticeTimer.current = setTimeout(() => {
      startFullNoticeText(async () => {
        await setFullPeriodNoticeTextAction(serviceId, v);
      });
    }, 700);
  }
  const [rows, setRows] = useState<DemRow[]>(() =>
    initialRows.map((r, i) => ({
      key: `db-${i}`,
      demandeurId: r.demandeurId,
      validation: r.validation,
      themes: r.themes,
      themeRequired: r.themeRequired,
    })),
  );

  // Autosave Demandeurs + Globaux (débounce). Signature de la dernière sauvegarde.
  // Init paresseuse (sentinelle null) : éviter de relancer buildMatrix+matrixSig à CHAQUE
  // rendu (l'argument de useRef est évalué à chaque rendu même s'il n'est utilisé qu'une fois).
  const lastSavedSig = useRef<string | null>(null);
  if (lastSavedSig.current === null) {
    lastSavedSig.current = matrixSig(buildMatrix(rows));
  }
  const [savedFlash, setSavedFlash] = useState(false);
  const flashTimer = useRef<number | null>(null);
  const [demError, setDemError] = useState<string | null>(null);
  const [demPending, startSaveDem] = useTransition();
  const firstRender = useRef(true);
  // État d'auto-save du bloc « Validation & auto-validation », remonté par le composant
  // enfant : fusionné avec celui des demandeurs dans la pastille du titre.
  const [svsStatus, setSvsStatus] = useState<SaveStatus>({
    pending: false,
    saved: false,
    error: null,
  });

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const payload = buildMatrix(rows);
    const sig = matrixSig(payload);
    if (sig === lastSavedSig.current) return; // rien de neuf à persister
    const handle = window.setTimeout(() => {
      startSaveDem(async () => {
        const res = await saveDemandeurSettingsAction({ serviceId, rows: payload });
        if (res && !res.ok) {
          setDemError(res.error ?? "Échec de l'enregistrement.");
          return;
        }
        lastSavedSig.current = sig;
        setDemError(null);
        setSavedFlash(true);
        if (flashTimer.current) window.clearTimeout(flashTimer.current);
        flashTimer.current = window.setTimeout(() => setSavedFlash(false), 1600);
      });
    }, 450);
    return () => window.clearTimeout(handle);
  }, [rows, serviceId]);

  // Thèmes : AUTOSAVE débouncé (même mécanique que les demandeurs, décision 2026-09-10).
  // La liste locale est conservée telle qu'éditée (lignes vides, doublons en cours de saisie) :
  // seule la version NETTOYÉE part au serveur, et c'est sa signature qui décide s'il y a
  // quelque chose de neuf à persister — sinon une ligne fraîchement ajoutée et encore vide
  // disparaîtrait sous les doigts de l'utilisateur.
  const [themeMode, setThemeMode] = useState<ThemeMode>(initialThemeMode);
  const [themes, setThemes] = useState<ThemeRow[]>(() =>
    initialThemes.map((label, i) => ({ key: `db-${i}`, label })),
  );
  const nextThemeId = () => `new-${counter.current++}`;
  const lastThemesSig = useRef<string | null>(null);
  if (lastThemesSig.current === null) {
    lastThemesSig.current = JSON.stringify([initialThemeMode, cleanLabels(initialThemes)]);
  }
  const [themesError, setThemesError] = useState<string | null>(null);
  const [themesPending, startThemes] = useTransition();
  const [themesFlash, setThemesFlash] = useState(false);
  const themesFlashTimer = useRef<number | null>(null);
  const firstThemesRender = useRef(true);

  useEffect(() => {
    if (firstThemesRender.current) {
      firstThemesRender.current = false;
      return;
    }
    const cleaned = cleanLabels(themes.map((t) => t.label));
    const sig = JSON.stringify([themeMode, cleaned]);
    if (sig === lastThemesSig.current) return; // rien de neuf à persister
    const handle = window.setTimeout(() => {
      startThemes(async () => {
        const res = await saveThemesAction({ serviceId, mode: themeMode, themes: cleaned });
        if (res && !res.ok) {
          setThemesError(res.error ?? "Échec de l'enregistrement.");
          return;
        }
        lastThemesSig.current = sig;
        setThemesError(null);
        setThemesFlash(true);
        if (themesFlashTimer.current) window.clearTimeout(themesFlashTimer.current);
        themesFlashTimer.current = window.setTimeout(() => setThemesFlash(false), 1600);
      });
    }, 700);
    return () => window.clearTimeout(handle);
  }, [themeMode, themes, serviceId]);

  // Suppression d'un thème : confirmée (l'autosave ne laisse plus de « Annuler » pour
  // rattraper une corbeille cliquée par erreur).
  const [confirmDeleteTheme, setConfirmDeleteTheme] = useState<ThemeRow | null>(null);
  function deleteTheme(key: string) {
    setThemes((ts) => ts.filter((x) => x.key !== key));
    setConfirmDeleteTheme(null);
  }

  // ── Demandeurs : helpers (mémoïsés : recalcul seulement quand rows/allDemandeurs changent) ──
  const usedIds = useMemo(
    () => new Set(rows.map((r) => r.demandeurId).filter((id) => id > 0)),
    [rows],
  );
  const available = useMemo(
    () => allDemandeurs.filter((d) => !usedIds.has(d.id)),
    [allDemandeurs, usedIds],
  );
  const labelFor = useCallback(
    (id: number) => allDemandeurs.find((d) => d.id === id)?.label ?? "",
    [allDemandeurs],
  );

  function patch(key: string, p: Partial<DemRow>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  }
  function removeRow(key: string) {
    setRows((rs) => rs.filter((r) => r.key !== key));
  }
  function addRow() {
    setRows((rs) => [
      ...rs,
      {
        key: `new-${counter.current++}`,
        demandeurId: 0,
        validation: false,
        themes: false,
        themeRequired: false,
      },
    ]);
  }

  const configuredRows = rows.filter((r) => r.demandeurId > 0).length;

  // Pastille du titre : fusion des trois autosaves (demandeurs, bloc Validation, thèmes).
  const statusError = demError ?? svsStatus.error ?? themesError;
  const statusPending = demPending || svsStatus.pending || themesPending;
  const statusSaved = savedFlash || svsStatus.saved || themesFlash;

  return (
    <div className="panel">
      {/* Titre : pictogramme + intitulé + compteurs ; à droite, statut autosave
          (Globaux + Demandeurs) en pastille, comme le seuil RGPD. */}
      <div
        className="panel-title"
        style={{ justifyContent: "space-between", gap: ".75rem", marginBottom: ".5rem" }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: ".6rem", whiteSpace: "nowrap" }}>
          <span className="rg-ico is-ok">
            <SettingsGlyph size={16} />
          </span>
          Configuration du service
          <span style={{ color: "var(--muted)", fontWeight: 400 }}>
            · {configuredRows} demandeur{configuredRows > 1 ? "s" : ""} ·{" "}
            {themeMode === "libre"
              ? "thème libre"
              : `${themes.length} thème${themes.length > 1 ? "s" : ""}`}
          </span>
        </span>
        <span className="acct-toolbar-right">
          <span
            className={`acct-pill ${statusError ? "role-administrateur" : statusPending ? "is-warn" : "is-ok"}`}
            style={{
              opacity: statusError || statusPending || statusSaved ? 1 : 0,
              transition: "opacity .25s",
            }}
            aria-live="polite"
          >
            {statusError ? (
              <AlertGlyph size={12} strokeWidth={2.2} />
            ) : (
              <CircleCheckGlyph size={12} strokeWidth={2.2} />
            )}{" "}
            {statusError ? statusError : statusPending ? "Enregistrement…" : "Enregistré"}
          </span>
        </span>
      </div>

      {/* ─ Réglages globaux (autosave) ─ */}
      <div className="ms-grp cfg-grp">
        Paramètres globaux
        <span className="hint">· comportement du service pour tous les demandeurs</span>
      </div>

      {/* Validation & auto-validation (verrou, auto-validation, notification gestionnaires). */}
      <ServiceValidationSettings
        serviceId={serviceId}
        onStatus={setSvsStatus}
        validationBloquante={validationBloquante}
        autoValidationDelay={autoValidationDelay}
        mgrNoticeMode={mgrNoticeMode}
        mgrNoticeIntervalHours={mgrNoticeIntervalHours}
        mgrNoticeHour={mgrNoticeHour}
        mgrNoticeWeekday={mgrNoticeWeekday}
      />

      {/* Récurrent (Modèle) et alternance A/B ne sont plus des réglages service : tout
          service propose des créneaux récurrents, et la parité A/B se choisit créneau par
          créneau via le bouton « Semaine A/B » de l'agenda. La jauge s'active PAR CRÉNEAU
          (icône capsule du mode création). */}
      <GlobalRow
        icon={
          <span className="rg-ico is-ok">
            <UsersGlyph size={14} />
          </span>
        }
        label="Jauge : prise en compte des accompagnants"
        desc="Prendre en compte les accompagnants dans le calcul de la jauge des créneaux qui en ont une."
      >
        <StateSwitch on={gaugeAccompagnants} onChange={toggleGaugeAccompagnants} />
      </GlobalRow>

      {/* Absences prévenues (cf. services/booking-absence) : l'usager signale depuis son
          agenda qu'il sera absent à une séance (macaron « A » du badge, bouton d'aide),
          le gestionnaire l'enregistre dans la fiche. Opt-in par service. */}
      <GlobalRow
        icon={
          <span className="rg-ico is-warn">
            <CalendarTimeGlyph size={14} />
          </span>
        }
        label="Absences prévenues"
        desc="Permet à l'usager de prévenir depuis son agenda qu'il sera absent à une séance (la réservation est conservée, le service est informé par e-mail) et au gestionnaire d'enregistrer une absence prévenue dans la fiche de réservation. Désactivé, les signalements déjà enregistrés restent visibles."
      >
        <StateSwitch on={absencePrevenue} onChange={toggleAbsencePrevenue} />
      </GlobalRow>

      {/* Liste d'attente (cf. services/waiting-list) : l'usager dépose ses disponibilités
          par demi-journée ; la tâche planifiée le prévient (ou le réserve automatiquement)
          dès qu'un créneau réservable correspondant a de la place. Opt-in par service. */}
      <GlobalRow
        icon={
          <span className="rg-ico is-info">
            <ListDetailsGlyph size={14} />
          </span>
        }
        label="Liste d'attente"
        desc="Quand tout est complet, l'usager peut s'inscrire sur la liste d'attente avec ses disponibilités par demi-journée. Il est prévenu par e-mail dès qu'un créneau correspondant se libère, ou inscrit automatiquement s'il l'a demandé. Les inscrits sont visibles depuis l'agenda."
      >
        <StateSwitch on={listeAttente} onChange={toggleListeAttente} />
      </GlobalRow>

      {/* Alerte « plus de place » : modale --warn côté usager quand plus aucune
          occurrence de la période affichée n'est réservable (l'e-mail proposé
          vient du référentiel Services, Administration > Configuration). Le
          texte du message est personnalisable ; la ligne « contacter le
          service » avec l'e-mail reste ajoutée automatiquement. */}
      <GlobalRow
        icon={
          <span className="rg-ico is-warn">
            <AlertGlyph size={14} />
          </span>
        }
        label="Alerte « plus de place »"
        desc="À l'arrivée sur l'agenda ou sur une période, si plus aucun créneau de la période affichée n'est réservable, informe l'usager et l'invite à contacter le service (e-mail de contact du référentiel Services). Texte personnalisable ci-dessous ; vide, le message par défaut s'affiche."
        below={
          fullPeriodNotice ? (
            <textarea
              className="cfg-textarea"
              value={fullNoticeText}
              maxLength={600}
              placeholder={
                "Toutes les séances de cette période sont complètes. De nouvelles places peuvent se libérer en cas d'annulation : n'hésitez pas à revenir consulter l'agenda."
              }
              onChange={(e) => changeFullNoticeText(e.target.value)}
              aria-label="Texte personnalisé de l'alerte « plus de place »"
            />
          ) : undefined
        }
      >
        <StateSwitch on={fullPeriodNotice} onChange={toggleFullPeriodNotice} />
      </GlobalRow>

      {/* ─ Demandeurs (autosave) ─ */}
      <div className="ms-grp cfg-grp">
        Demandeurs
        <span className="hint">· validation et thèmes, structure par structure</span>
      </div>

      <div className="cfg-dhead">
        <span />
        <span>Demandeur</span>
        <span>Validation</span>
        <span>Thèmes</span>
        <span>Thème obligatoire</span>
        <span />
      </div>

      {rows.map((r) => (
        <div key={r.key} className="cfg-drow">
          <span className="acct-avatar role-utilisateur">
            {r.demandeurId > 0 ? labelInitials(labelFor(r.demandeurId)) : "?"}
          </span>
          {r.demandeurId > 0 ? (
            <span className="ex-knm" style={{ minWidth: 0 }}>
              {labelFor(r.demandeurId)}
            </span>
          ) : (
            <select
              className="cfg-select"
              value=""
              onChange={(e) =>
                patch(r.key, { demandeurId: Number.parseInt(e.target.value, 10) || 0 })
              }
              style={{ width: "60%" }}
            >
              <option value="">— Choisir un demandeur —</option>
              {available.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          )}
          <span className="cfg-c">
            <Switch on={r.validation} onChange={(v) => patch(r.key, { validation: v })} />
          </span>
          <span className="cfg-c">
            {/* Éteindre « Thèmes » retire le champ à l'usager : le rendre
                obligatoire n'aurait alors plus de sens, on retombe donc aussi
                l'obligation plutôt que de laisser un réglage sans effet visible
                qui se réveillerait à la réactivation. */}
            <Switch
              on={r.themes}
              onChange={(v) => patch(r.key, { themes: v, ...(v ? {} : { themeRequired: false }) })}
            />
          </span>
          <span className="cfg-c">
            <Switch
              on={r.themeRequired}
              disabled={!r.themes}
              onChange={(v) => patch(r.key, { themeRequired: v })}
            />
          </span>
          <div className="ms-acts">
            <button
              type="button"
              className="acct-action is-danger"
              onClick={() => removeRow(r.key)}
              title="Retirer ce demandeur"
              aria-label="Retirer ce demandeur"
            >
              <TrashGlyph size={14} />
            </button>
          </div>
        </div>
      ))}

      {rows.length === 0 && (
        <div
          style={{
            padding: ".8rem .5rem",
            fontSize: ".78rem",
            color: "var(--muted)",
            fontStyle: "italic",
          }}
        >
          Aucun demandeur configuré. Cliquez sur « Ajouter un demandeur ».
        </div>
      )}
      {/* Ajout sous le tableau, aligné à droite. */}
      <div style={{ display: "flex", justifyContent: "flex-end", padding: ".5rem .5rem 0" }}>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={addRow}
          disabled={available.length === 0}
          style={headBtn}
        >
          ＋ Ajouter un demandeur
        </button>
      </div>

      {/* ─ Thèmes (barre de sauvegarde dédiée) ─ */}
      <div className="ms-grp cfg-grp" style={{ marginTop: "2.05rem" }}>
        Thèmes
        <span className="hint">
          ·{" "}
          {themeMode === "libre"
            ? "l'usager saisit un thème de son choix"
            : "l'usager choisit parmi une liste prédéfinie"}
        </span>
        <span className="cfg-grp-right">
          {(
            [
              ["libre", "Thème libre"],
              ["liste", "Liste de thèmes"],
            ] as [ThemeMode, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={themeMode === value}
              className={`acct-chip${themeMode === value ? " is-on" : ""}`}
              onClick={() => setThemeMode(value)}
            >
              {label}
            </button>
          ))}
        </span>
      </div>

      {themeMode === "liste" &&
        themes.map((t, i) => (
          <div key={t.key} className="cfg-trow">
            <span className="cfg-num">{i + 1}</span>
            <input
              type="text"
              value={t.label}
              placeholder="Nom du thème"
              aria-label={`Thème ${i + 1}`}
              // biome-ignore lint/a11y/noAutofocus: focus légitime après action utilisateur (« Ajouter un thème »)
              autoFocus={t.key.startsWith("new-")}
              onChange={(e) =>
                setThemes((ts) =>
                  ts.map((x) => (x.key === t.key ? { ...x, label: e.target.value } : x)),
                )
              }
            />
            <div className="ms-acts">
              <button
                type="button"
                className="acct-action is-danger"
                onClick={() =>
                  // Ligne encore vide : rien à confirmer, on la retire directement.
                  t.label.trim() === "" ? deleteTheme(t.key) : setConfirmDeleteTheme(t)
                }
                title="Supprimer ce thème"
                aria-label="Supprimer ce thème"
              >
                <TrashGlyph size={14} />
              </button>
            </div>
          </div>
        ))}
      {/* Ajout sous la liste, aligné à droite. */}
      {themeMode === "liste" && (
        <div style={{ display: "flex", justifyContent: "flex-end", padding: ".5rem .5rem 0" }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setThemes((ts) => [...ts, { key: nextThemeId(), label: "" }])}
            style={headBtn}
          >
            ＋ Ajouter un thème
          </button>
        </div>
      )}

      {/* Pied : rappel du mode d'enregistrement (tout est autosave). */}
      <div className="rg-foot" style={{ borderTop: "none", marginTop: "2.05rem", paddingTop: 0 }}>
        <InfoGlyph size={13} />
        <span style={{ flex: 1, lineHeight: 1.45 }}>
          Tous les réglages de cette page sont enregistrés automatiquement, quelques instants après
          chaque modification.
        </span>
      </div>

      {/* Modale de confirmation de suppression d'un thème (--danger), même dessin que la
          suppression d'un type d'e-mail dans Échanges. */}
      {confirmDeleteTheme && (
        <ModalOverlay
          onClose={() => setConfirmDeleteTheme(null)}
          boxStyle={{ maxWidth: 460, width: "95vw" }}
        >
          <div
            className="modal-title"
            style={{ color: "var(--danger)", display: "flex", alignItems: "center", gap: ".5rem" }}
          >
            <TrashGlyph size={16} /> Supprimer le thème
          </div>
          <p style={{ fontSize: ".85rem", lineHeight: 1.5, margin: "0 0 .4rem" }}>
            Vous êtes sur le point de retirer le thème{" "}
            <strong>« {confirmDeleteTheme.label.trim()} »</strong> de la liste proposée aux usagers.
          </p>
          <p
            style={{
              fontSize: ".78rem",
              color: "var(--muted)",
              margin: "0 0 1rem",
              lineHeight: 1.45,
            }}
          >
            Les réservations déjà faites avec ce thème le conservent. La suppression est enregistrée
            aussitôt.
          </p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: ".5rem" }}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setConfirmDeleteTheme(null)}
              style={{ fontSize: ".78rem" }}
            >
              Annuler
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => deleteTheme(confirmDeleteTheme.key)}
              style={{
                fontSize: ".78rem",
                background: "var(--danger)",
                border: "none",
                color: "var(--text)",
                display: "inline-flex",
                alignItems: "center",
                gap: ".35rem",
              }}
            >
              <TrashGlyph size={13} /> Supprimer
            </button>
          </div>
          <button type="button" className="modal-close" onClick={() => setConfirmDeleteTheme(null)}>
            ×
          </button>
        </ModalOverlay>
      )}

      <style>{CFG_CSS}</style>
    </div>
  );
}
