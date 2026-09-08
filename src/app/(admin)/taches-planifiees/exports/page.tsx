import { requireRole } from "@/server/guards";
import { AGE_RETAIN_DAYS, getBackupMode, listBackups } from "@/server/services/backup";
import { getCronSchedule } from "@/server/services/cron-tasks";
import { type BackupRow, BackupsPanel } from "./backups-panel";

export const dynamic = "force-dynamic";

export default async function SauvegardesPage() {
  // Administration réservée aux administrateurs.
  await requireRole("administrateur");
  const [files, mode, schedule] = await Promise.all([
    listBackups(),
    getBackupMode(),
    getCronSchedule("backup"),
  ]);

  const rows: BackupRow[] = files.map((f) => ({
    name: f.name,
    kind: f.kind,
    size: f.size,
    mtime: f.mtime.toISOString(),
    encrypted: f.encrypted,
    // Purge par âge des manuels / téléversés (cf. purgeAgedBackups) : échéance affichée.
    purgeAt:
      f.kind === "auto"
        ? null
        : new Date(f.mtime.getTime() + AGE_RETAIN_DAYS * 86_400_000).toISOString(),
  }));

  return (
    <BackupsPanel
      rows={rows}
      toolsAvailable={mode !== null}
      schedule={schedule}
      generatedAt={new Date().toISOString()}
    />
  );
}
