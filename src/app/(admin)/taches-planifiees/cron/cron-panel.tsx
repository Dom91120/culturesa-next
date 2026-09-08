"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import {
  BellGlyph,
  CalendarTimeGlyph,
  CircleCheckGlyph,
  DatabaseExportGlyph,
  FileCodeGlyph,
  HourglassGlyph,
  MailForwardGlyph,
  PlayGlyph,
  RefreshGlyph,
  RepeatGlyph,
  ShieldLockGlyph,
} from "@/components/ui-glyphs";
import { DATETIME_FMT_FR as dtFmt } from "@/lib/format";
import type { CronSchedule, CronTaskKey } from "@/server/services/cron-tasks";
import { ActionIconButton } from "../../users/account-ui";
import { runCronTaskAction, updateCronScheduleAction } from "./actions";

// ════════════════════════════════════════════════════════════════════════════
//  Tâches planifiées — refonte Dom 2026-09-08 (même famille visuelle que les Comptes) :
//  trois tuiles (dernier passage du cron, dernière exécution, prochaine échéance), une
//  ligne par tâche avec pictogramme, planification en pastille éditable, point d'état de
//  la dernière exécution (vert / orange en retard / rouge en erreur), prochaine échéance
//  en relatif, bouton « Exécuter » à pictogramme. Explication et crontab en pied.
// ════════════════════════════════════════════════════════════════════════════

/** Tâche sérialisée reçue du serveur (dates en ISO string). */
export type CronTaskRow = {
  key: CronTaskKey;
  label: string;
  description: string;
  schedule: CronSchedule;
  scheduleLabel: string;
  runnable: boolean;
  nextRun: string;
  lastRun: { at: string; ok: boolean; trigger: "cron" | "manuel"; summary: string } | null;
};

// Pas proposés pour la planification « par intervalle » (grille d'appel : 5 min).
const STEP_OPTIONS = [5, 10, 15, 30, 60, 120];

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Pictogramme et famille (métier = accent, technique = neutre) de chaque tâche. */
const TASK_ICON: Record<CronTaskKey, { glyph: React.ReactNode; tech: boolean }> = {
  "auto-validate": { glyph: <CircleCheckGlyph size={16} />, tech: false },
  "validation-notice": { glyph: <MailForwardGlyph size={16} />, tech: false },
  "waiting-list": { glyph: <HourglassGlyph size={16} />, tech: false },
  "booking-reminder": { glyph: <BellGlyph size={16} />, tech: false },
  "rgpd-retention": { glyph: <ShieldLockGlyph size={16} />, tech: true },
  backup: { glyph: <DatabaseExportGlyph size={16} />, tech: true },
};

/** « dans 3 min », « dans 2 h », « dans 12 h », « il y a 47 j »… */
function relative(iso: string, nowMs: number): string {
  const diff = new Date(iso).getTime() - nowMs;
  const abs = Math.abs(diff);
  const min = Math.round(abs / 60000);
  let txt: string;
  if (min < 1) txt = "moins d'une minute";
  else if (min < 60) txt = `${min} min`;
  else if (min < 48 * 60) txt = `${Math.round(min / 60)} h`;
  else txt = `${Math.round(min / 1440)} j`;
  return diff >= 0 ? `dans ${txt}` : `il y a ${txt}`;
}

/** Délai maximal « normal » entre deux exécutions : 3 intervalles, ou 26 h à heure fixe. */
function staleAfterMs(s: CronSchedule): number {
  return s.type === "everyMinutes" ? s.step * 3 * 60000 : 26 * 3600000;
}

/**
 * Pastille de planification : type (intervalle / heure fixe) + valeur, chaque changement
 * enregistré immédiatement (action serveur). Les champs vivent dans la pastille.
 */
function SchedulePill({
  schedule,
  disabled,
  onChange,
}: {
  schedule: CronSchedule;
  disabled: boolean;
  onChange: (s: CronSchedule) => void;
}) {
  const steps =
    schedule.type === "everyMinutes" && !STEP_OPTIONS.includes(schedule.step)
      ? [...STEP_OPTIONS, schedule.step].sort((a, b) => a - b)
      : STEP_OPTIONS;
  return (
    <span
      className="cron-sched"
      title="Planification : modifiable, prise en compte au prochain passage"
    >
      {schedule.type === "everyMinutes" ? (
        <RepeatGlyph size={13} />
      ) : (
        <CalendarTimeGlyph size={13} />
      )}
      <select
        value={schedule.type}
        disabled={disabled}
        aria-label="Type de planification"
        onChange={(e) =>
          onChange(
            e.target.value === "everyMinutes"
              ? { type: "everyMinutes", step: 15 }
              : { type: "dailyAt", hour: 7, minute: 0 },
          )
        }
      >
        <option value="everyMinutes">Toutes les</option>
        <option value="dailyAt">Tous les jours à</option>
      </select>
      {schedule.type === "everyMinutes" ? (
        <select
          value={schedule.step}
          disabled={disabled}
          aria-label="Intervalle"
          onChange={(e) => onChange({ type: "everyMinutes", step: Number(e.target.value) })}
        >
          {steps.map((m) => (
            <option key={m} value={m}>
              {m % 60 === 0 ? `${m / 60} h` : `${m} min`}
            </option>
          ))}
        </select>
      ) : (
        <input
          type="time"
          value={`${pad2(schedule.hour)}:${pad2(schedule.minute)}`}
          disabled={disabled}
          aria-label="Heure"
          onChange={(e) => {
            const [h, m] = e.target.value.split(":").map(Number);
            if (Number.isInteger(h) && Number.isInteger(m))
              onChange({ type: "dailyAt", hour: h, minute: m });
          }}
        />
      )}
    </span>
  );
}

export function CronPanel({
  rows,
  cronSecretConfigured,
  crontab,
  lastCronPass,
  generatedAt,
}: {
  rows: CronTaskRow[];
  cronSecretConfigured: boolean;
  crontab: string | null;
  /** Dernier appel du conteneur cron (max des déclenchements planifiés), ISO ou null. */
  lastCronPass: string | null;
  /** Instant du relevé serveur (ISO) : base des libellés relatifs, stable à l'hydratation. */
  generatedAt: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [runningKey, setRunningKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ key: string; ok: boolean; text: string } | null>(null);
  const [nowMs, setNowMs] = useState(() => new Date(generatedAt).getTime());
  useEffect(() => {
    setNowMs(new Date(generatedAt).getTime());
  }, [generatedAt]);

  function runNow(row: CronTaskRow) {
    if (
      !confirm(
        `Exécuter « ${row.label} » maintenant ?\n\n` +
          "Le traitement est identique à celui déclenché par le planificateur " +
          "(idempotent : une exécution supplémentaire n'envoie pas de doublons).",
      )
    )
      return;
    setFeedback(null);
    setRunningKey(row.key);
    startTransition(async () => {
      const res = await runCronTaskAction(row.key);
      setRunningKey(null);
      setFeedback(
        res.ok
          ? { key: row.key, ok: true, text: `Exécutée — ${res.summary}` }
          : { key: row.key, ok: false, text: res.error },
      );
      router.refresh();
    });
  }

  function changeSchedule(row: CronTaskRow, schedule: CronSchedule) {
    setFeedback(null);
    startTransition(async () => {
      const res = await updateCronScheduleAction(row.key, schedule);
      if (!res.ok) setFeedback({ key: row.key, ok: false, text: res.error });
      router.refresh();
    });
  }

  // Tuiles : dernière exécution consignée (toutes tâches), prochaine échéance (+ nombre
  // de tâches à la même minute).
  const lastRunRow = rows
    .filter((r) => r.lastRun)
    .sort((a, b) => (a.lastRun?.at ?? "").localeCompare(b.lastRun?.at ?? ""))
    .at(-1);
  const nextIso = rows.map((r) => r.nextRun).sort()[0] ?? null;
  const nextCount = nextIso
    ? rows.filter(
        (r) => Math.abs(new Date(r.nextRun).getTime() - new Date(nextIso).getTime()) < 60000,
      ).length
    : 0;

  return (
    <div className="panel">
      <div
        className="panel-title"
        style={{ justifyContent: "space-between", gap: ".75rem", marginBottom: ".7rem" }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: ".6rem" }}>
          <span className="dot" style={{ background: "var(--accent)" }} />
          Tâches planifiées
          <span style={{ color: "var(--muted)", fontWeight: 400 }}>· {rows.length}</span>
        </span>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => startTransition(() => router.refresh())}
          disabled={pending}
          style={{
            padding: ".25rem .65rem",
            fontSize: ".68rem",
            display: "inline-flex",
            alignItems: "center",
            gap: ".35rem",
          }}
        >
          <RefreshGlyph size={13} /> Rafraîchir
        </button>
      </div>

      {!cronSecretConfigured && (
        <p
          style={{
            fontSize: ".78rem",
            color: "var(--danger)",
            marginBottom: ".75rem",
            lineHeight: 1.5,
          }}
        >
          ⚠️ Secret CRON absent (variable d'environnement <code>CRON_SECRET</code>) : les appels du
          conteneur cron seront refusés (401) et les tâches ne s'exécuteront pas automatiquement.
          L'exécution manuelle ci-dessous reste possible.
        </p>
      )}

      <div className="cron-kpis">
        <div className="cron-kpi">
          <div className="l">Dernier passage du cron</div>
          {lastCronPass ? (
            <>
              <div className="v" title={dtFmt.format(new Date(lastCronPass))}>
                <span
                  className={`cron-dot ${nowMs - new Date(lastCronPass).getTime() > 15 * 60000 ? "is-warn" : "is-ok"}`}
                />
                {relative(lastCronPass, nowMs)}
              </div>
              <div className="s">
                {dtFmt.format(new Date(lastCronPass))} · appel toutes les 5 min
              </div>
            </>
          ) : (
            <>
              <div className="v">
                <span className="cron-dot is-warn" />
                jamais
              </div>
              <div className="s">aucun déclenchement planifié consigné</div>
            </>
          )}
        </div>
        <div className="cron-kpi">
          <div className="l">Dernière exécution</div>
          {lastRunRow?.lastRun ? (
            <>
              <div className="v">
                <span className={`cron-dot ${lastRunRow.lastRun.ok ? "is-ok" : "is-ko"}`} />
                {lastRunRow.label}
              </div>
              <div className="s">
                {dtFmt.format(new Date(lastRunRow.lastRun.at))} · {lastRunRow.lastRun.trigger}
              </div>
            </>
          ) : (
            <div className="v">—</div>
          )}
        </div>
        <div className="cron-kpi">
          <div className="l">Prochaine échéance</div>
          {nextIso ? (
            <>
              <div className="v">{relative(nextIso, nowMs)}</div>
              <div className="s">
                {dtFmt.format(new Date(nextIso))} · {nextCount} tâche{nextCount > 1 ? "s" : ""}
              </div>
            </>
          ) : (
            <div className="v">—</div>
          )}
        </div>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table className="acct-table cron-table" style={{ minWidth: 900 }}>
          <colgroup>
            <col style={{ width: "36%" }} />
            <col style={{ width: 160 }} />
            <col />
            <col style={{ width: 150 }} />
            <col style={{ width: 52 }} />
          </colgroup>
          <thead>
            <tr>
              <th>Tâche</th>
              <th>Planification</th>
              <th>Dernière exécution</th>
              <th>Prochaine</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const last = t.lastRun;
              const isRunning = runningKey === t.key;
              const fb = feedback?.key === t.key ? feedback : null;
              const icon = TASK_ICON[t.key];
              // État : rouge = échec consigné ; orange = pas d'exécution depuis trop longtemps
              // au regard de sa planification ; vert sinon.
              const lastMs = last ? new Date(last.at).getTime() : 0;
              const state = !last
                ? "warn"
                : !last.ok
                  ? "ko"
                  : nowMs - lastMs > staleAfterMs(t.schedule)
                    ? "warn"
                    : "ok";
              return (
                <tr key={t.key}>
                  <td>
                    <div className="cron-task">
                      <span className={`cron-ico ${icon.tech ? "is-tech" : "is-metier"}`}>
                        {icon.glyph}
                      </span>
                      <div style={{ minWidth: 0 }}>
                        <div className="name">{t.label}</div>
                        <div className="desc" title={t.description}>
                          {t.description}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    {t.runnable ? (
                      <SchedulePill
                        schedule={t.schedule}
                        disabled={pending}
                        onChange={(s) => changeSchedule(t, s)}
                      />
                    ) : (
                      <>
                        <div style={{ fontSize: ".75rem" }}>{t.scheduleLabel}</div>
                        <div className="cron-sub">(fixe — conteneur cron)</div>
                      </>
                    )}
                  </td>
                  <td>
                    {last ? (
                      <>
                        <div
                          title={
                            state === "warn"
                              ? "Aucune exécution depuis plus longtemps que prévu par la planification"
                              : state === "ko"
                                ? "La dernière exécution a échoué"
                                : "Dernière exécution réussie"
                          }
                        >
                          <span className={`cron-dot is-${state}`} />
                          {dtFmt.format(new Date(last.at))}
                          <span style={{ color: "var(--muted)" }}> · {last.trigger}</span>
                        </div>
                        {last.summary && (
                          <div
                            className="cron-sub"
                            style={last.ok ? undefined : { color: "var(--danger)" }}
                          >
                            {last.summary}
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <span className="cron-dot is-warn" />
                        <span style={{ color: "var(--muted)", fontStyle: "italic" }}>
                          Aucune exécution consignée
                        </span>
                      </>
                    )}
                    {fb && (
                      <div
                        className="cron-sub"
                        style={{ color: fb.ok ? "var(--accent)" : "var(--danger)" }}
                      >
                        {fb.text}
                      </div>
                    )}
                  </td>
                  <td>
                    <div>{dtFmt.format(new Date(t.nextRun))}</div>
                    <div className="cron-sub">{relative(t.nextRun, nowMs)}</div>
                  </td>
                  <td>
                    <div className="acct-actions" style={{ opacity: 1 }}>
                      {t.runnable ? (
                        <ActionIconButton
                          label={isRunning ? "Exécution en cours…" : "Exécuter maintenant"}
                          disabled={pending}
                          onClick={() => runNow(t)}
                        >
                          {isRunning ? <HourglassGlyph /> : <PlayGlyph />}
                        </ActionIconButton>
                      ) : (
                        <Link
                          href="/taches-planifiees/exports"
                          className="acct-action"
                          title="Gérer les exports dans le sous-onglet Exports"
                          aria-label="Voir les exports"
                        >
                          <DatabaseExportGlyph />
                        </Link>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="cron-foot">
        {/* Légende des points d'état, sur une ligne (Dom 2026-09-08). */}
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: ".9rem",
            whiteSpace: "nowrap",
          }}
        >
          <span title="Dernière exécution réussie, dans les délais de sa planification">
            <span className="cron-dot is-ok" />à jour
          </span>
          <span title="Aucune exécution depuis plus de trois intervalles (ou 26 h à heure fixe)">
            <span className="cron-dot is-warn" />
            en retard : rien depuis plus de 3 intervalles (ou 26 h)
          </span>
          <span title="La dernière exécution a échoué">
            <span className="cron-dot is-ko" />
            en échec
          </span>
        </span>
        <span>
          En production, le conteneur cron (busybox crond, fuseau Europe/Paris) appelle chaque route{" "}
          <code>/api/cron/*</code> toutes les 5 minutes ; la planification ci-dessus décide si la
          tâche s'exécute, et un changement est pris en compte au prochain passage. Une exécution
          manuelle fait exactement le même traitement, idempotent.
        </span>
        {crontab && (
          <details>
            <summary>
              <FileCodeGlyph size={13} /> Contenu du fichier <code>cron/crontab</code>
            </summary>
            <pre
              style={{
                marginTop: ".5rem",
                padding: ".75rem 1rem",
                fontSize: ".7rem",
                lineHeight: 1.5,
                background: "var(--surface1)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                overflowX: "auto",
                color: "var(--text)",
              }}
            >
              {crontab}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}
