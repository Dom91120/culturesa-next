"use client";

// Onglet « Configuration » : réglages globaux + matrice demandeurs (AUTOSAVE) et
// thèmes (barre de sauvegarde dédiée). Le récurrent et l'alternance Semaine A/B sont
// désormais toujours disponibles et se pilotent créneau par créneau dans l'agenda
// (bouton « Semaine A/B ») ; la matrice service × demandeur ne porte plus que
// validation/thèmes.

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Switch } from "@/components/switch";
import type { DemandeurSettingRow } from "@/server/services/demandeur-settings";
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
import { ServiceValidationSettings } from "./service-validation-settings";

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

// ── Panneau ──────────────────────────────────────────────────────────────────

/** Style des 3 sous-panels (fond --surface2) imbriqués dans le panel conteneur
 *  (--surface1, via .panel). Hiérarchie : page(--surface) < conteneur < sous-panels. */
const SUB_PANEL: React.CSSProperties = {
  background: "var(--surface2)",
  border: "1px solid var(--border)",
  borderRadius: "var(--rad-sm)",
  padding: "1.25rem",
};

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

  // Thèmes : barre de sauvegarde explicite (base « enregistrée » mutable).
  const [themeMode, setThemeMode] = useState<ThemeMode>(initialThemeMode);
  const [themes, setThemes] = useState<ThemeRow[]>(() =>
    initialThemes.map((label, i) => ({ key: `db-${i}`, label })),
  );
  const [savedThemeMode, setSavedThemeMode] = useState<ThemeMode>(initialThemeMode);
  const [savedThemes, setSavedThemes] = useState<string[]>(initialThemes);
  const [themesError, setThemesError] = useState<string | null>(null);
  const [themesPending, startThemes] = useTransition();
  const nextThemeId = () => `new-${counter.current++}`;
  const themesDirty = useMemo(
    () =>
      JSON.stringify([themeMode, themes.map((t) => t.label)]) !==
      JSON.stringify([savedThemeMode, savedThemes]),
    [themeMode, themes, savedThemeMode, savedThemes],
  );

  function saveThemes() {
    const cleaned = cleanLabels(themes.map((t) => t.label));
    startThemes(async () => {
      const res = await saveThemesAction({ serviceId, mode: themeMode, themes: cleaned });
      if (res && !res.ok) {
        setThemesError(res.error ?? "Échec de l'enregistrement.");
        return;
      }
      setThemesError(null);
      setSavedThemeMode(themeMode);
      setSavedThemes(cleaned);
      setThemes(cleaned.map((label, i) => ({ key: `db-${i}`, label })));
    });
  }
  function cancelThemes() {
    setThemesError(null);
    setThemeMode(savedThemeMode);
    setThemes(savedThemes.map((label, i) => ({ key: `db-${i}`, label })));
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

  return (
    <section className="panel">
      {/* En-tête du panel conteneur : titre à gauche, statut autosave (Globaux + Demandeurs)
          à droite. */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "1rem",
          minHeight: 18,
          // Mêmes espacements haut/bas que l'en-tête « Exercice » (onglet Périodes).
          margin: ".75rem 0 1.75rem",
        }}
      >
        <div>
          <div className="panel-title" style={{ marginBottom: ".15rem" }}>
            <span className="dot" style={{ background: "var(--warn)" }} />
            Configuration du service
          </div>
          <p style={{ fontSize: ".75rem", color: "var(--muted)", margin: 0 }}>
            Réglages s'appliquant à tout le service.
          </p>
        </div>
        <span
          style={{
            fontSize: ".72rem",
            transition: "opacity .25s",
            opacity: demError || demPending || savedFlash ? 1 : 0,
            color: demError ? "var(--danger)" : "var(--accent)",
          }}
        >
          {demError ? demError : demPending ? "Enregistrement…" : "✓ Enregistré"}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: ".85rem" }}>
        {/* ─ Réglages globaux (autosave) ─ */}
        <section style={SUB_PANEL}>
          {/* marginBottom réduite : la 1re ligne (GlobalRow) ajoute .75rem de padding haut ;
              on compense pour aligner l'écart sur celui de « Demandeurs » / « Thèmes ». */}
          <div className="panel-title" style={{ marginBottom: ".25rem" }}>
            <span className="dot" style={{ background: "var(--accent)" }} />
            Paramètres globaux
          </div>

          {/* Validation & auto-validation (verrou, auto-validation, notification gestionnaires). */}
          <ServiceValidationSettings
            serviceId={serviceId}
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
              (icône capsule du mode création). Dernière ligne du bloc → pas de bordure basse. */}
          <GlobalRow
            label="Jauge — prise en compte des accompagnants"
            desc="Prendre en compte les accompagnants dans le calcul de la jauge des créneaux qui en ont une."
          >
            <Switch on={gaugeAccompagnants} onChange={toggleGaugeAccompagnants} />
          </GlobalRow>

          {/* Absences prévenues (cf. services/booking-absence) : l'usager signale depuis son
              agenda qu'il sera absent à une séance (macaron « A » du badge, bouton d'aide),
              le gestionnaire l'enregistre dans la fiche. Opt-in par service. */}
          <GlobalRow
            label="Absences prévenues"
            desc="Permet à l'usager de prévenir depuis son agenda qu'il sera absent à une séance (la réservation est conservée, le service est informé par e-mail) et au gestionnaire d'enregistrer une absence prévenue dans la fiche de réservation. Désactivé, les signalements déjà enregistrés restent visibles."
          >
            <Switch on={absencePrevenue} onChange={toggleAbsencePrevenue} />
          </GlobalRow>

          {/* Liste d'attente (cf. services/waiting-list) : l'usager dépose ses disponibilités
              par demi-journée ; la tâche planifiée le prévient (ou le réserve automatiquement)
              dès qu'un créneau réservable correspondant a de la place. Opt-in par service. */}
          <GlobalRow
            label="Liste d'attente"
            desc="Quand tout est complet, l'usager peut s'inscrire sur la liste d'attente avec ses disponibilités par demi-journée. Il est prévenu par e-mail dès qu'un créneau correspondant se libère — ou inscrit automatiquement s'il l'a demandé. Les inscrits sont visibles depuis l'agenda."
          >
            <Switch on={listeAttente} onChange={toggleListeAttente} />
          </GlobalRow>

          {/* Alerte « plus de place » : modale --warn côté usager quand plus aucune
              occurrence de la période affichée n'est réservable (l'e-mail proposé
              vient du référentiel Services, Administration > Configuration). Le
              texte du message est personnalisable ; la ligne « contacter le
              service » avec l'e-mail reste ajoutée automatiquement. */}
          <GlobalRow
            label="Alerte « plus de place »"
            desc="À l'arrivée sur l'agenda ou sur une période, si plus aucun créneau de la période affichée n'est réservable, informe l'usager et l'invite à contacter le service (e-mail de contact du référentiel Services). Texte personnalisable ci-contre — vide, le message par défaut s'affiche."
            align="start"
            last
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-end",
                gap: ".45rem",
                paddingTop: ".5rem",
              }}
            >
              <Switch on={fullPeriodNotice} onChange={toggleFullPeriodNotice} />
              {fullPeriodNotice && (
                <textarea
                  value={fullNoticeText}
                  maxLength={600}
                  placeholder={
                    "Toutes les séances de cette période sont complètes. De nouvelles places peuvent se libérer en cas d'annulation : n'hésitez pas à revenir consulter l'agenda."
                  }
                  onChange={(e) => changeFullNoticeText(e.target.value)}
                  aria-label="Texte personnalisé de l'alerte « plus de place »"
                  style={{
                    width: 320,
                    maxWidth: "100%",
                    minHeight: 74,
                    resize: "vertical",
                    fontSize: ".76rem",
                    lineHeight: 1.4,
                    padding: ".4rem .5rem",
                    borderRadius: "var(--rad-sm)",
                    border: "1px solid var(--border)",
                    background: "var(--surface1)",
                    color: "var(--text)",
                  }}
                />
              )}
            </div>
          </GlobalRow>
        </section>

        {/* ─ Demandeurs (autosave) ─ */}
        <section style={SUB_PANEL}>
          <div className="panel-title" style={{ justifyContent: "space-between" }}>
            <span style={{ display: "flex", alignItems: "center", gap: ".6rem" }}>
              <span className="dot" style={{ background: "var(--accent)" }} />
              Demandeurs
            </span>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={addRow}
              disabled={available.length === 0}
              style={{ fontSize: ".66rem", padding: ".2rem .5rem" }}
            >
              ＋ Ajouter un demandeur
            </button>
          </div>

          <div style={{ marginTop: "1rem" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) 84px 84px 84px 32px",
                gap: ".75rem",
                alignItems: "center",
                padding: "0 .75rem .5rem",
                fontSize: ".66rem",
                fontWeight: 600,
                letterSpacing: ".05em",
                textTransform: "uppercase",
                color: "var(--muted)",
              }}
            >
              <span>Demandeur</span>
              <span style={{ textAlign: "center" }}>Validation</span>
              <span style={{ textAlign: "center" }}>Thèmes</span>
              {/* Deux lignes resserrées : l'intitulé ne tient pas sur la largeur d'une
                  colonne d'interrupteur, et l'élargir décalerait les trois autres. */}
              <span style={{ textAlign: "center", lineHeight: 1.15 }}>
                Thème
                <br />
                obligatoire
              </span>
              <span />
            </div>

            {rows.map((r) => (
              <div
                key={r.key}
                className="mockup-row"
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr) 84px 84px 84px 32px",
                  gap: ".75rem",
                  alignItems: "center",
                  padding: ".55rem .75rem",
                  borderRadius: "var(--rad-sm)",
                  borderTop: "1px solid var(--border)",
                }}
              >
                {r.demandeurId > 0 ? (
                  <span style={{ fontSize: ".85rem", fontWeight: 600, color: "var(--text)" }}>
                    {labelFor(r.demandeurId)}
                  </span>
                ) : (
                  <select
                    value=""
                    onChange={(e) =>
                      patch(r.key, { demandeurId: Number.parseInt(e.target.value, 10) || 0 })
                    }
                    style={{
                      width: "50%",
                      fontSize: ".82rem",
                      padding: ".25rem .4rem",
                      background: "var(--surface2)",
                      color: "var(--text)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--rad-sm)",
                    }}
                  >
                    <option value="">— Choisir un demandeur —</option>
                    {available.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                )}
                <span style={{ display: "flex", justifyContent: "center" }}>
                  <Switch on={r.validation} onChange={(v) => patch(r.key, { validation: v })} />
                </span>
                <span style={{ display: "flex", justifyContent: "center" }}>
                  {/* Éteindre « Thèmes » retire le champ à l'usager : le rendre
                      obligatoire n'aurait alors plus de sens, on retombe donc aussi
                      l'obligation plutôt que de laisser un réglage sans effet visible
                      qui se réveillerait à la réactivation. */}
                  <Switch
                    on={r.themes}
                    onChange={(v) =>
                      patch(r.key, { themes: v, ...(v ? {} : { themeRequired: false }) })
                    }
                  />
                </span>
                <span style={{ display: "flex", justifyContent: "center" }}>
                  <Switch
                    on={r.themeRequired}
                    disabled={!r.themes}
                    onChange={(v) => patch(r.key, { themeRequired: v })}
                  />
                </span>
                <button
                  type="button"
                  className="mockup-x"
                  onClick={() => removeRow(r.key)}
                  title="Retirer ce demandeur"
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--muted)",
                    fontSize: "1rem",
                    lineHeight: 1,
                    borderRadius: 6,
                    padding: ".25rem",
                    transition: "opacity .15s",
                  }}
                >
                  ✕
                </button>
              </div>
            ))}

            {rows.length === 0 && (
              <div
                style={{
                  padding: "1.5rem",
                  textAlign: "center",
                  fontSize: ".82rem",
                  color: "var(--muted)",
                  borderTop: "1px solid var(--border)",
                }}
              >
                Aucun demandeur configuré. Cliquez sur « Ajouter un demandeur ».
              </div>
            )}
          </div>
        </section>

        {/* ─ Thèmes (barre de sauvegarde dédiée) ─ */}
        <section style={SUB_PANEL}>
          <div className="panel-title" style={{ justifyContent: "space-between" }}>
            <span style={{ display: "flex", alignItems: "center", gap: ".6rem" }}>
              <span className="dot" style={{ background: "var(--accent)" }} />
              Thèmes
            </span>
            {themeMode === "liste" && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setThemes((ts) => [...ts, { key: nextThemeId(), label: "" }])}
                style={{ fontSize: ".66rem", padding: ".2rem .5rem" }}
              >
                ＋ Ajouter un thème
              </button>
            )}
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "1.5rem",
              flexWrap: "wrap",
              margin: "1rem 0 .25rem",
            }}
          >
            {(
              [
                ["libre", "Thème libre"],
                ["liste", "Liste de thèmes"],
              ] as [ThemeMode, string][]
            ).map(([value, label]) => (
              <label
                key={value}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: ".45rem",
                  cursor: "pointer",
                  fontSize: ".85rem",
                  fontWeight: 400,
                  color: "var(--text)",
                  textTransform: "none",
                  letterSpacing: "normal",
                }}
              >
                <input
                  type="radio"
                  name="theme-mode"
                  checked={themeMode === value}
                  onChange={() => setThemeMode(value)}
                  style={{ accentColor: "var(--accent)" }}
                />
                {label}
              </label>
            ))}
            <span style={{ fontSize: ".74rem", color: "var(--muted)" }}>
              {themeMode === "libre"
                ? "L'usager saisit un thème de son choix."
                : "L'usager choisit parmi une liste prédéfinie."}
            </span>
          </div>

          {themeMode === "liste" && (
            <div style={{ marginTop: ".75rem" }}>
              {themes.map((t) => (
                <div
                  key={t.key}
                  className="mockup-row"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: ".5rem",
                    borderRadius: "var(--rad-sm)",
                  }}
                >
                  <input
                    type="text"
                    className="mockup-theme-input"
                    value={t.label}
                    placeholder="Nom du thème"
                    onChange={(e) =>
                      setThemes((ts) =>
                        ts.map((x) => (x.key === t.key ? { ...x, label: e.target.value } : x)),
                      )
                    }
                    style={{
                      flex: 1,
                      fontSize: ".85rem",
                      padding: ".25rem .75rem",
                      border: "none",
                      background: "transparent",
                      color: "var(--text)",
                      outline: "none",
                      borderRadius: "var(--rad-sm)",
                      transition: "background .15s, box-shadow .15s",
                    }}
                  />
                  <button
                    type="button"
                    className="mockup-x"
                    onClick={() => setThemes((ts) => ts.filter((x) => x.key !== t.key))}
                    title="Supprimer ce thème"
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "var(--muted)",
                      fontSize: "1rem",
                      lineHeight: 1,
                      borderRadius: 6,
                      padding: ".3rem",
                      marginRight: ".4rem",
                      flexShrink: 0,
                      transition: "opacity .15s",
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}

              {themes.length === 0 && (
                <div style={{ padding: ".6rem .75rem", fontSize: ".8rem", color: "var(--muted)" }}>
                  Aucun thème — utilisez « ＋ Ajouter un thème ».
                </div>
              )}
            </div>
          )}

          {/* Barre de sauvegarde — Thèmes uniquement, toujours visible. */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: ".6rem",
              marginTop: ".9rem",
            }}
          >
            <span
              style={{
                fontSize: ".78rem",
                color: themesError ? "var(--danger)" : themesDirty ? "var(--warn)" : "var(--muted)",
              }}
            >
              {themesError
                ? themesError
                : themesDirty
                  ? "Modifications non enregistrées"
                  : "À jour"}
            </span>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={cancelThemes}
              disabled={!themesDirty || themesPending}
              style={{
                fontSize: ".75rem",
                padding: ".3rem .8rem",
                opacity: themesDirty && !themesPending ? 1 : 0.4,
                cursor: themesDirty && !themesPending ? "pointer" : "not-allowed",
              }}
            >
              Annuler
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={saveThemes}
              disabled={!themesDirty || themesPending}
              style={{
                fontSize: ".75rem",
                padding: ".3rem .9rem",
                opacity: themesDirty && !themesPending ? 1 : 0.4,
                cursor: themesDirty && !themesPending ? "pointer" : "not-allowed",
              }}
            >
              {themesPending ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </section>
      </div>

      <style>
        {
          ".mockup-row:hover{background:var(--surface3)}.mockup-x{opacity:0}.mockup-row:hover .mockup-x{opacity:1}.mockup-theme-input:hover{background:var(--surface3)}.mockup-theme-input:focus{background:var(--surface3);box-shadow:inset 0 -2px 0 var(--accent)}"
        }
      </style>
    </section>
  );
}
