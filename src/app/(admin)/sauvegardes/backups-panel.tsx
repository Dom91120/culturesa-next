"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { createBackupAction, deleteBackupAction, restoreBackupAction } from "./actions";

/** Dump sérialisé reçu du serveur (date en ISO string). */
export type BackupRow = {
  name: string;
  kind: "auto" | "manuel" | "televerse";
  size: number;
  mtime: string;
};

const KIND_META: Record<BackupRow["kind"], { label: string; color: string }> = {
  auto: { label: "Automatique", color: "var(--accent)" },
  manuel: { label: "Manuel", color: "#e8a45a" },
  televerse: { label: "Téléversé", color: "var(--slot-uniq-color)" },
};

const dtFmt = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export function BackupsPanel({
  rows,
  toolsAvailable,
}: {
  rows: BackupRow[];
  toolsAvailable: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [restoreName, setRestoreName] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      setInfo("Export créé ✓");
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

  function restore() {
    if (!restoreName) return;
    setError(null);
    setInfo(null);
    if (
      !confirm(
        `RESTAURER la base à partir de « ${restoreName} » ?\n\n` +
          "TOUTES les données actuelles (réservations, comptes, configuration…) seront " +
          "remplacées par le contenu de ce dump. Cette opération est irréversible.\n\n" +
          "Les sessions ouvertes pourront être déconnectées (reconnexion nécessaire).",
      )
    )
      return;
    startTransition(async () => {
      const res = await restoreBackupAction(restoreName);
      if (res && !res.ok) {
        setError(res.error ?? "Échec de la restauration.");
        return;
      }
      setInfo("Base restaurée ✓ — rechargement…");
      // Recharge complet : tout l'état client (données, session) peut avoir changé.
      window.location.reload();
    });
  }

  const btnGhostSmall = { padding: ".25rem .7rem", fontSize: ".72rem" } as const;

  return (
    <div>
      {/* ── Exports ── */}
      <div className="panel-title" style={{ padding: ".3rem 0" }}>
        <span className="dot" style={{ background: "var(--warn)" }} />
        Sauvegardes — Exports de la base
      </div>
      <p
        style={{
          fontSize: ".78rem",
          color: "var(--muted)",
          marginBottom: "1rem",
          lineHeight: 1.5,
        }}
      >
        Dumps PostgreSQL complets (schéma + données), restaurables tels quels. En production,
        un export automatique est créé chaque nuit à 02h00 (rotation : 7 jours) ; les exports
        manuels et téléversés ne sont pas soumis à la rotation.
      </p>

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
          joignable) : la création d'export et la restauration sont désactivées. Le
          téléchargement des fichiers existants reste possible.
        </p>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: ".4rem",
          flexWrap: "wrap",
          marginBottom: ".75rem",
        }}
      >
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="btn btn-ghost"
          onClick={refresh}
          disabled={pending}
          style={btnGhostSmall}
        >
          🔄 Rafraîchir
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={createNow}
          disabled={pending || !toolsAvailable}
          style={{
            ...btnGhostSmall,
            borderColor: "color-mix(in srgb, var(--accent) 40%, transparent)",
            color: "var(--accent)",
            opacity: toolsAvailable ? 1 : 0.4,
          }}
        >
          📦 Créer un export maintenant
        </button>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table zebra">
          <thead>
            <tr>
              <th style={{ textAlign: "center" }}>Fichier</th>
              <th style={{ textAlign: "center", width: "1%", whiteSpace: "nowrap" }}>Type</th>
              <th style={{ textAlign: "center", width: "1%", whiteSpace: "nowrap" }}>Date</th>
              <th style={{ textAlign: "center", width: "1%", whiteSpace: "nowrap" }}>Taille</th>
              <th style={{ textAlign: "center", width: "1%", whiteSpace: "nowrap" }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => {
              const meta = KIND_META[f.kind];
              return (
                <tr key={f.name}>
                  <td style={{ fontFamily: "monospace", fontSize: ".72rem" }}>{f.name}</td>
                  <td style={{ textAlign: "center" }}>
                    <span style={{ color: meta.color, fontWeight: 600, fontSize: ".7rem" }}>
                      {meta.label}
                    </span>
                  </td>
                  <td style={{ textAlign: "center", whiteSpace: "nowrap", color: "var(--muted)" }}>
                    {dtFmt.format(new Date(f.mtime))}
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap", color: "var(--muted)" }}>
                    {fmtSize(f.size)}
                  </td>
                  <td style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                    <a
                      className="btn btn-ghost"
                      href={`/api/backups/download?file=${encodeURIComponent(f.name)}`}
                      style={{
                        padding: ".05rem .5rem",
                        fontSize: ".72rem",
                        textDecoration: "none",
                        marginRight: ".3rem",
                      }}
                      title="Télécharger ce dump"
                    >
                      ⬇️ Télécharger
                    </a>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => deleteOne(f.name)}
                      disabled={pending}
                      style={{
                        padding: ".05rem .5rem",
                        fontSize: ".72rem",
                        borderColor: "rgba(224,107,107,.4)",
                        color: "var(--danger)",
                      }}
                      title="Supprimer ce dump"
                    >
                      🗑️
                    </button>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  style={{
                    textAlign: "center",
                    padding: "1.5rem",
                    color: "var(--muted)",
                    fontStyle: "italic",
                  }}
                >
                  Aucun export pour l'instant.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: ".5rem", fontSize: ".7rem", color: "var(--muted)" }}>
        {rows.length} export{rows.length > 1 ? "s" : ""}
      </div>

      {/* ── Restauration ── */}
      <div className="panel-title" style={{ padding: ".3rem 0", marginTop: "2rem" }}>
        <span className="dot" style={{ background: "var(--danger)" }} />
        Restaurer à partir d'un dump
      </div>
      <p
        style={{
          fontSize: ".78rem",
          color: "var(--muted)",
          marginBottom: ".75rem",
          lineHeight: 1.5,
        }}
      >
        Remplace <strong>l'intégralité</strong> de la base par le contenu du dump sélectionné
        (tout-ou-rien : en cas d'erreur, la base actuelle est conservée). Choisissez un export
        de la liste ci-dessus ou téléversez un fichier <code>.sql</code> / <code>.sql.gz</code>.
      </p>

      <div style={{ display: "flex", alignItems: "center", gap: ".6rem", flexWrap: "wrap" }}>
        <select
          value={restoreName}
          onChange={(e) => setRestoreName(e.target.value)}
          disabled={pending || uploading}
          style={{
            fontSize: ".78rem",
            padding: ".3rem .5rem",
            borderRadius: "var(--rad-sm)",
            border: "1px solid var(--border)",
            background: "var(--surface2)",
            color: "var(--text)",
            minWidth: 280,
          }}
        >
          <option value="">— Choisir un dump —</option>
          {rows.map((f) => (
            <option key={f.name} value={f.name}>
              {f.name} ({fmtSize(f.size)})
            </option>
          ))}
        </select>

        <input
          ref={fileInputRef}
          type="file"
          accept=".sql,.gz"
          disabled={pending || uploading}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
          style={{ fontSize: ".72rem", color: "var(--muted)", maxWidth: 260 }}
        />

        <button
          type="button"
          className="btn btn-ghost"
          onClick={restore}
          disabled={pending || uploading || !restoreName || !toolsAvailable}
          style={{
            padding: ".3rem .9rem",
            fontSize: ".75rem",
            borderColor: "rgba(224,107,107,.4)",
            color: "var(--danger)",
            opacity: restoreName && toolsAvailable ? 1 : 0.4,
          }}
        >
          ♻️ Restaurer la base
        </button>
      </div>

      {(error || info || uploading) && (
        <p
          style={{
            marginTop: ".75rem",
            fontSize: ".78rem",
            color: error ? "var(--danger)" : "var(--accent)",
          }}
        >
          {error ?? (uploading ? "Téléversement…" : info)}
        </p>
      )}
    </div>
  );
}
