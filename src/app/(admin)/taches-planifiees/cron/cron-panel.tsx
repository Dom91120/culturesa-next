"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { INPUT_CHROME } from "@/components/ui-styles";
import { DATE_FMT_FR as dateFmt, DATETIME_FMT_FR as dtFmt } from "@/lib/format";
import type { CronSchedule, CronTaskKey } from "@/server/services/cron-tasks";
import { runCronTaskAction, updateCronScheduleAction } from "./actions";

/** Heure seule "HH:MM" (fr-FR) — la date est affichée sur sa propre ligne. */
const TIME_FMT_FR = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });

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

// Champs de planification sans bordure, fond ni padding (chrome neutre, cf. demande UI).
const scheduleInputStyle: React.CSSProperties = {
  fontSize: ".72rem",
  padding: 0,
  ...INPUT_CHROME,
  border: "none",
  background: "transparent",
};

/**
 * Éditeur compact de la planification d'une tâche : type (intervalle / heure fixe)
 * + valeur. Chaque changement est enregistré immédiatement (action serveur).
 */
function ScheduleEditor({
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
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        // Pas d'espace vertical quand l'éditeur passe sur 2 lignes (gap horizontal seul).
        gap: "0 .3rem",
        flexWrap: "wrap",
      }}
    >
      <select
        value={schedule.type}
        disabled={disabled}
        onChange={(e) =>
          onChange(
            e.target.value === "everyMinutes"
              ? { type: "everyMinutes", step: 15 }
              : { type: "dailyAt", hour: 7, minute: 0 },
          )
        }
        style={scheduleInputStyle}
      >
        <option value="everyMinutes">Par intervalle</option>
        <option value="dailyAt">Tous les jours à</option>
      </select>
      {schedule.type === "everyMinutes" ? (
        <select
          value={schedule.step}
          disabled={disabled}
          onChange={(e) => onChange({ type: "everyMinutes", step: Number(e.target.value) })}
          style={scheduleInputStyle}
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
          onChange={(e) => {
            const [h, m] = e.target.value.split(":").map(Number);
            if (Number.isInteger(h) && Number.isInteger(m))
              onChange({ type: "dailyAt", hour: h, minute: m });
          }}
          style={scheduleInputStyle}
        />
      )}
    </div>
  );
}

export function CronPanel({
  rows,
  cronSecretConfigured,
  crontab,
}: {
  rows: CronTaskRow[];
  cronSecretConfigured: boolean;
  crontab: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Tâche en cours d'exécution manuelle + résultat de la dernière exécution demandée.
  const [runningKey, setRunningKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ key: string; ok: boolean; text: string } | null>(null);

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
          ? { key: row.key, ok: true, text: `Exécutée ✓ — ${res.summary}` }
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

  const smallMuted = { fontSize: ".7rem", color: "var(--muted)" } as const;

  return (
    <div className="panel">
      {/* ── Planification ── */}
      <div className="panel-title" style={{ padding: ".3rem 0" }}>
        <span className="dot" style={{ background: "var(--accent)" }} />
        Tâches CRON
      </div>
      <p
        style={{
          fontSize: ".78rem",
          color: "var(--muted)",
          marginBottom: "1rem",
          lineHeight: 1.5,
        }}
      >
        En production, un conteneur dédié (busybox crond, fuseau Europe/Paris) appelle les routes{" "}
        <code>/api/cron/*</code> de l'application toutes les 5 minutes : chaque tâche applique la
        planification configurée ci-dessous et ne s'exécute que si son échéance est atteinte. Un
        changement de planification est donc pris en compte au prochain passage, sans redéploiement.
        Chaque exécution est consignée ici ; les tâches peuvent aussi être lancées manuellement, le
        traitement est identique et idempotent.
      </p>

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

      <div className="admin-table-wrap">
        <table className="admin-table zebra">
          <thead>
            <tr>
              <th style={{ textAlign: "center" }}>Tâche</th>
              <th style={{ textAlign: "center", width: "1%", whiteSpace: "nowrap" }}>
                Planification
              </th>
              <th style={{ textAlign: "center", width: "1%" }}>
                Dernière
                <br />
                exécution
              </th>
              <th style={{ textAlign: "center", width: "1%" }}>
                Prochaine
                <br />
                exécution
              </th>
              <th style={{ textAlign: "center", width: "1%", whiteSpace: "nowrap" }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const last = t.lastRun;
              const isRunning = runningKey === t.key;
              const fb = feedback?.key === t.key ? feedback : null;
              return (
                <tr key={t.key}>
                  <td>
                    <div style={{ fontWeight: 600, fontSize: ".78rem", lineHeight: "1.4rem" }}>
                      {t.label}
                    </div>
                    <div style={{ ...smallMuted, maxWidth: 420 }}>{t.description}</div>
                  </td>
                  <td style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                    {t.runnable ? (
                      <ScheduleEditor
                        schedule={t.schedule}
                        disabled={pending}
                        onChange={(s) => changeSchedule(t, s)}
                      />
                    ) : (
                      <>
                        <div style={{ fontSize: ".75rem" }}>{t.scheduleLabel}</div>
                        <div style={smallMuted}>(fixe — conteneur cron)</div>
                      </>
                    )}
                  </td>
                  <td style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                    {last ? (
                      <>
                        <div
                          style={{ fontSize: ".75rem", whiteSpace: "nowrap", lineHeight: "1.4rem" }}
                        >
                          <span style={{ color: last.ok ? "var(--accent)" : "var(--danger)" }}>
                            {last.ok ? "✓" : "✗"}
                          </span>{" "}
                          {dtFmt.format(new Date(last.at))}{" "}
                          <span style={smallMuted}>({last.trigger})</span>
                        </div>
                        {last.summary && (
                          <div
                            style={{
                              ...smallMuted,
                              color: last.ok ? "var(--muted)" : "var(--danger)",
                            }}
                          >
                            {/* Un segment par ligne (retour à la ligne après chaque virgule). */}
                            {last.summary.split(", ").map((part) => (
                              <div key={part}>{part}</div>
                            ))}
                          </div>
                        )}
                      </>
                    ) : (
                      <span style={{ ...smallMuted, fontStyle: "italic" }}>
                        Aucune exécution consignée
                      </span>
                    )}
                    {fb && (
                      <div
                        style={{
                          fontSize: ".72rem",
                          marginTop: ".25rem",
                          color: fb.ok ? "var(--accent)" : "var(--danger)",
                        }}
                      >
                        {fb.text}
                      </div>
                    )}
                  </td>
                  <td
                    style={{
                      textAlign: "center",
                      whiteSpace: "nowrap",
                      color: "var(--muted)",
                      verticalAlign: "middle",
                    }}
                  >
                    <div>{dateFmt.format(new Date(t.nextRun))}</div>
                    <div>{TIME_FMT_FR.format(new Date(t.nextRun))}</div>
                  </td>
                  <td style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                    {t.runnable ? (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => runNow(t)}
                        disabled={pending}
                        style={{
                          padding: ".25rem .45rem",
                          fontSize: ".72rem",
                          borderColor: "color-mix(in srgb, var(--accent) 40%, transparent)",
                          color: "var(--accent)",
                          opacity: pending ? 0.5 : 1,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: ".3rem",
                        }}
                        title="Lancer cette tâche immédiatement"
                      >
                        <span aria-hidden="true">{isRunning ? "⏳" : "▶️"}</span>
                        <span style={{ textAlign: "left", lineHeight: 1.25 }}>
                          {isRunning ? (
                            "Exécution…"
                          ) : (
                            <>
                              Exécuter
                              <br />
                              maintenant
                            </>
                          )}
                        </span>
                      </button>
                    ) : (
                      <Link
                        href="/taches-planifiees/exports"
                        className="btn btn-ghost"
                        style={{
                          padding: ".25rem .45rem",
                          fontSize: ".72rem",
                          textDecoration: "none",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: ".3rem",
                        }}
                        title="Gérer les exports dans le sous-onglet Exports"
                      >
                        <span aria-hidden="true">💾</span>
                        <span style={{ textAlign: "left", lineHeight: 1.25 }}>
                          Voir les
                          <br />
                          exports
                        </span>
                      </Link>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: ".4rem",
          marginTop: ".5rem",
          // Calé sur le padding horizontal des cellules (.6rem) : le compteur s'aligne à
          // gauche et le bouton à droite avec le CONTENU du tableau, pas avec ses bords.
          padding: "0 .6rem",
        }}
      >
        <span style={{ ...smallMuted }}>
          {rows.length} tâche{rows.length > 1 ? "s" : ""} planifiée{rows.length > 1 ? "s" : ""}
        </span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => startTransition(() => router.refresh())}
          disabled={pending}
          style={{ padding: ".25rem .7rem", fontSize: ".72rem" }}
        >
          🔄 Rafraîchir
        </button>
      </div>

      {/* ── Contenu brut du crontab (dispo hors Docker : le fichier vit dans cron/) ── */}
      {crontab && (
        <details style={{ marginTop: "1.5rem" }}>
          <summary style={{ fontSize: ".78rem", color: "var(--muted)", cursor: "pointer" }}>
            Contenu du fichier <code>cron/crontab</code>
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
            }}
          >
            {crontab}
          </pre>
        </details>
      )}
    </div>
  );
}
