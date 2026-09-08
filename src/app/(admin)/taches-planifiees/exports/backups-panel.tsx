"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { ConfirmPasswordModal } from "@/components/confirm-password-modal";
import {
  DatabaseExportGlyph,
  DatabaseGlyph,
  LockGlyph,
  LockOpenGlyph,
  RefreshGlyph,
  RestoreGlyph,
  UploadGlyph,
} from "@/components/ui-glyphs";
import { INPUT_CHROME } from "@/components/ui-styles";
import { DATETIME_FMT_FR as dtFmt } from "@/lib/format";
import type { CronSchedule } from "@/server/services/cron-tasks";
import { ActionIconButton, DownloadGlyph, TrashGlyph } from "../../users/account-ui";
import { createBackupAction, deleteBackupAction, restoreBackupAction } from "./actions";

// ════════════════════════════════════════════════════════════════════════════
//  Exports de la base — refonte Dom 2026-09-08 (même famille que les Tâches planifiées) :
//  trois tuiles (dernier export automatique avec point d'état, volume conservé, dumps en
//  clair à traiter), une ligne par export avec pictogramme teinté par type, avertissement
//  « en clair » en toutes lettres, date relative et échéance de purge, actions au survol
//  (télécharger / restaurer / supprimer), bloc de restauration cerné de rouge, explication
//  en pied.
// ════════════════════════════════════════════════════════════════════════════

/** Dump sérialisé reçu du serveur (dates en ISO string). */
export type BackupRow = {
  name: string;
  kind: "auto" | "manuel" | "televerse";
  size: number;
  mtime: string;
  /** Chiffré au repos ? `false` = dump en clair antérieur au chiffrement (constat D1). */
  encrypted: boolean;
  /** Purge par âge (manuels / téléversés), ISO ; null pour les automatiques (rotation). */
  purgeAt: string | null;
};

const KIND_META: Record<BackupRow["kind"], { label: string; cls: string }> = {
  auto: { label: "Automatique", cls: "is-auto" },
  manuel: { label: "Manuel", cls: "is-manuel" },
  televerse: { label: "Téléversé", cls: "is-televerse" },
};

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

/** « il y a 3 j », « dans 27 j », « à l'instant »… */
function relative(iso: string, nowMs: number): string {
  const diff = new Date(iso).getTime() - nowMs;
  const min = Math.round(Math.abs(diff) / 60000);
  let txt: string;
  if (min < 1) txt = "moins d'une minute";
  else if (min < 60) txt = `${min} min`;
  else if (min < 48 * 60) txt = `${Math.round(min / 60)} h`;
  else txt = `${Math.round(min / 1440)} j`;
  return diff >= 0 ? `dans ${txt}` : `il y a ${txt}`;
}

/** Libellé court de la planification de l'export automatique. */
function scheduleText(s: CronSchedule): string {
  if (s.type === "everyMinutes")
    return s.step % 60 === 0 ? `toutes les ${s.step / 60} h` : `toutes les ${s.step} min`;
  return `chaque nuit à ${String(s.hour).padStart(2, "0")}:${String(s.minute).padStart(2, "0")}`;
}

/** Délai « normal » entre deux exports automatiques : 3 intervalles, ou 26 h à heure fixe. */
function staleAfterMs(s: CronSchedule): number {
  return s.type === "everyMinutes" ? s.step * 3 * 60000 : 26 * 3600000;
}

export function BackupsPanel({
  rows,
  toolsAvailable,
  schedule,
  generatedAt,
}: {
  rows: BackupRow[];
  toolsAvailable: boolean;
  /** Planification de l'export automatique (sous-onglet CRON). */
  schedule: CronSchedule;
  /** Instant du relevé serveur (ISO) : base des libellés relatifs, stable à l'hydratation. */
  generatedAt: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [restoreName, setRestoreName] = useState("");
  const [uploading, setUploading] = useState(false);
  // Confirmation par mot de passe avant restauration (constat BAC3) : remplacer
  // la base entière ne doit pas tenir à un cookie de session.
  const [confirmRestore, setConfirmRestore] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [nowMs, setNowMs] = useState(() => new Date(generatedAt).getTime());
  useEffect(() => {
    setNowMs(new Date(generatedAt).getTime());
  }, [generatedAt]);

  function refresh() {
    startTransition(() => {
      router.refresh();
    });
  }

  function createNow() {
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const res = await createBackupAction();
      if (res && !res.ok) {
        setError(res.error ?? "Échec de l'export.");
        return;
      }
      setInfo("Export créé.");
      router.refresh();
    });
  }

  function deleteOne(name: string) {
    if (!confirm(`Supprimer définitivement le fichier « ${name} » ?`)) return;
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const res = await deleteBackupAction(name);
      if (res && !res.ok) {
        setError(res.error ?? "Échec de la suppression.");
        return;
      }
      if (restoreName === name) setRestoreName("");
      router.refresh();
    });
  }

  async function upload(file: File) {
    setError(null);
    setInfo(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/backups/upload", { method: "POST", body: fd });
      const json = (await res.json()) as { ok?: boolean; name?: string; error?: string };
      if (!res.ok || !json.ok || !json.name) {
        setError(json.error ?? "Échec du téléversement.");
        return;
      }
      setRestoreName(json.name);
      setInfo(`Dump téléversé : ${json.name}`);
      router.refresh();
    } catch {
      setError("Échec du téléversement.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function askRestore(name: string) {
    setRestoreName(name);
    setError(null);
    setConfirmRestore(true);
  }

  function restore(password: string) {
    if (!restoreName) return;
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const res = await restoreBackupAction(restoreName, password);
      if (res && !res.ok) {
        setError(res.error ?? "Échec de la restauration.");
        return;
      }
      setConfirmRestore(false);
      setInfo("Base restaurée — rechargement…");
      // Rechargement complet : tout l'état client (données, session) peut avoir changé.
      window.location.reload();
    });
  }

  // Tuiles.
  const lastAuto = rows
    .filter((r) => r.kind === "auto")
    .sort((a, b) => a.mtime.localeCompare(b.mtime))
    .at(-1);
  const autoState = !lastAuto
    ? "warn"
    : nowMs - new Date(lastAuto.mtime).getTime() > staleAfterMs(schedule)
      ? "warn"
      : "ok";
  const totalSize = rows.reduce((s, r) => s + r.size, 0);
  const clearCount = rows.filter((r) => !r.encrypted).length;

  const modaleRestauration = confirmRestore ? (
    <ConfirmPasswordModal
      titre="♻️ Restaurer la base"
      libelleAction="Restaurer"
      pending={pending}
      erreur={error}
      onCancel={() => setConfirmRestore(false)}
      onConfirm={restore}
    >
      <p style={{ marginBottom: ".5rem" }}>
        La base va être remplacée par le contenu de{" "}
        <strong style={{ fontFamily: "monospace" }}>{restoreName}</strong>.
      </p>
      <p style={{ color: "var(--muted)", fontSize: ".8rem" }}>
        <strong>Toutes</strong> les données actuelles — réservations, comptes, configuration —
        seront écrasées. L&apos;opération est irréversible, et les sessions ouvertes devront se
        reconnecter.
      </p>
    </ConfirmPasswordModal>
  ) : null;

  const headBtn = {
    padding: ".25rem .65rem",
    fontSize: ".68rem",
    display: "inline-flex",
    alignItems: "center",
    gap: ".35rem",
  } as const;

  return (
    <>
      {modaleRestauration}
      <div className="panel">
        <div
          className="panel-title"
          style={{ justifyContent: "space-between", gap: ".75rem", marginBottom: ".7rem" }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: ".6rem" }}>
            <span className="dot" style={{ background: "var(--warn)" }} />
            Exports de la base
            <span style={{ color: "var(--muted)", fontWeight: 400 }}>· {rows.length}</span>
          </span>
          <span style={{ display: "inline-flex", gap: ".5rem" }}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={refresh}
              disabled={pending}
              style={headBtn}
            >
              <RefreshGlyph size={13} /> Rafraîchir
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={createNow}
              disabled={pending || !toolsAvailable}
              title={toolsAvailable ? "Dump complet immédiat" : "Outils PostgreSQL indisponibles"}
              style={{
                ...headBtn,
                borderColor: "color-mix(in srgb, var(--accent) 40%, transparent)",
                color: "var(--accent)",
                opacity: toolsAvailable ? 1 : 0.4,
              }}
            >
              <DatabaseExportGlyph size={13} /> Créer un export
            </button>
          </span>
        </div>

        {!toolsAvailable && (
          <p
            style={{
              fontSize: ".78rem",
              color: "var(--danger)",
              marginBottom: ".75rem",
              lineHeight: 1.5,
            }}
          >
            ⚠️ Outils PostgreSQL indisponibles (ni pg_dump/psql locaux, ni conteneur Docker
            joignable) : la création d'export et la restauration sont désactivées. Le téléchargement
            des fichiers existants reste possible.
          </p>
        )}

        <div className="cron-kpis">
          <div className="cron-kpi">
            <div className="l">Dernier export automatique</div>
            {lastAuto ? (
              <>
                <div className="v" title={dtFmt.format(new Date(lastAuto.mtime))}>
                  <span className={`cron-dot is-${autoState}`} />
                  {relative(lastAuto.mtime, nowMs)}
                </div>
                <div className="s">
                  {dtFmt.format(new Date(lastAuto.mtime))} · attendu {scheduleText(schedule)}
                </div>
              </>
            ) : (
              <>
                <div className="v">
                  <span className="cron-dot is-warn" />
                  aucun
                </div>
                <div className="s">attendu {scheduleText(schedule)}</div>
              </>
            )}
          </div>
          <div className="cron-kpi">
            <div className="l">Exports conservés</div>
            <div className="v">
              {rows.length} · {fmtSize(totalSize)}
            </div>
            <div className="s">rotation : 7 automatiques ; 90 jours pour les autres</div>
          </div>
          <div className="cron-kpi">
            <div className="l">À traiter</div>
            {clearCount > 0 ? (
              <>
                <div className="v">
                  <span className="cron-dot is-warn" />
                  {clearCount} en clair
                </div>
                <div className="s">dumps antérieurs au chiffrement : à recréer puis supprimer</div>
              </>
            ) : (
              <>
                <div className="v">
                  <span className="cron-dot is-ok" />
                  rien
                </div>
                <div className="s">tous les exports sont chiffrés au repos</div>
              </>
            )}
          </div>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table className="acct-table cron-table" style={{ minWidth: 820 }}>
            <colgroup>
              <col style={{ width: "46%" }} />
              <col style={{ width: 120 }} />
              <col />
              <col style={{ width: 80 }} />
              <col style={{ width: 96 }} />
            </colgroup>
            <thead>
              <tr>
                <th>Export</th>
                <th>Type</th>
                <th>Date</th>
                <th style={{ textAlign: "right" }}>Taille</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => {
                const meta = KIND_META[f.kind];
                return (
                  <tr key={f.name}>
                    <td>
                      <div className="cron-task" style={{ alignItems: "center" }}>
                        <span className={`cron-ico bk-ico ${meta.cls}`}>
                          {f.kind === "televerse" ? (
                            <UploadGlyph size={16} />
                          ) : (
                            <DatabaseGlyph size={16} />
                          )}
                        </span>
                        <div style={{ minWidth: 0 }}>
                          <div
                            className="name"
                            style={{ fontFamily: "monospace", fontWeight: 500 }}
                          >
                            {f.name}
                          </div>
                          {/* Un dump en clair reste restaurable, mais expose des données
                              nominatives de mineurs : on le dit en toutes lettres. */}
                          {f.encrypted ? (
                            <div className="cron-sub">
                              <LockGlyph size={12} /> Chiffré au repos (AES-256-GCM)
                            </div>
                          ) : (
                            <div className="cron-sub" style={{ color: "var(--warn)" }}>
                              <LockOpenGlyph size={12} /> En clair, antérieur au chiffrement :
                              recréez un export puis supprimez celui-ci
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`acct-pill bk-pill ${meta.cls}`}>{meta.label}</span>
                    </td>
                    <td>
                      <div>{dtFmt.format(new Date(f.mtime))}</div>
                      <div className="cron-sub">
                        {relative(f.mtime, nowMs)}
                        {f.purgeAt && ` · supprimé ${relative(f.purgeAt, nowMs)}`}
                      </div>
                    </td>
                    <td style={{ textAlign: "right" }}>{fmtSize(f.size)}</td>
                    <td>
                      <div className="acct-actions">
                        <ActionIconButton
                          label="Télécharger ce dump"
                          href={`/api/backups/download?file=${encodeURIComponent(f.name)}`}
                        >
                          <DownloadGlyph />
                        </ActionIconButton>
                        <ActionIconButton
                          label="Restaurer la base à partir de cet export"
                          tone="warn"
                          disabled={pending || uploading || !toolsAvailable}
                          onClick={() => askRestore(f.name)}
                        >
                          <RestoreGlyph />
                        </ActionIconButton>
                        <ActionIconButton
                          label="Supprimer ce dump"
                          tone="danger"
                          disabled={pending}
                          onClick={() => deleteOne(f.name)}
                        >
                          <TrashGlyph />
                        </ActionIconButton>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr className="acct-empty">
                  <td colSpan={5}>Aucun export pour l'instant.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ── Restauration : bloc à part, cerné de rouge (remplace toute la base). ── */}
        <div className="bk-restore">
          <div style={{ marginRight: "auto", minWidth: 0 }}>
            <div
              style={{
                fontWeight: 600,
                color: "var(--danger)",
                display: "flex",
                alignItems: "center",
                gap: ".35rem",
              }}
            >
              <RestoreGlyph size={15} /> Restaurer la base
            </div>
            <div className="cron-sub">
              Remplace l'intégralité de la base par un export (tout-ou-rien : en cas d'erreur, la
              base actuelle est conservée). Un fichier téléversé <code>.sql</code>,{" "}
              <code>.sql.gz</code> ou <code>.sql.gz.enc</code> est chiffré avant d'être stocké.
            </div>
          </div>
          <select
            value={restoreName}
            onChange={(e) => setRestoreName(e.target.value)}
            disabled={pending || uploading}
            aria-label="Export à restaurer"
            style={{ fontSize: ".75rem", padding: ".3rem .5rem", ...INPUT_CHROME, minWidth: 250 }}
          >
            <option value="">Choisir un export…</option>
            {rows.map((f) => (
              <option key={f.name} value={f.name}>
                {f.name} ({fmtSize(f.size)})
              </option>
            ))}
          </select>
          <input
            ref={fileInputRef}
            type="file"
            accept=".sql,.gz,.enc"
            disabled={pending || uploading}
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => fileInputRef.current?.click()}
            disabled={pending || uploading}
            style={headBtn}
          >
            <UploadGlyph size={13} /> {uploading ? "Téléversement…" : "Téléverser un fichier"}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setError(null);
              setConfirmRestore(true);
            }}
            disabled={pending || uploading || !restoreName || !toolsAvailable}
            style={{
              ...headBtn,
              borderColor: "rgba(224,107,107,.4)",
              color: "var(--danger)",
              opacity: restoreName && toolsAvailable ? 1 : 0.4,
            }}
          >
            <RestoreGlyph size={13} /> Restaurer
          </button>
        </div>

        {(error || info) && (
          <p
            style={{
              marginTop: ".6rem",
              fontSize: ".78rem",
              color: error ? "var(--danger)" : "var(--accent)",
            }}
          >
            {error ?? info}
          </p>
        )}

        <div className="cron-foot">
          <span>
            Dumps PostgreSQL complets (schéma + données), restaurables tels quels. L'export
            automatique suit la planification du sous-onglet CRON ; seuls les 7 plus récents sont
            conservés. Les exports manuels et téléversés sont supprimés au bout de 90 jours : ce
            sont des copies nominatives complètes, qu'il n'y a pas lieu de garder indéfiniment. Le
            dernier export disponible n'est jamais supprimé.
          </span>
        </div>
      </div>
    </>
  );
}
