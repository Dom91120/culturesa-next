import { requireRole } from "@/server/guards";
import { getBackupMode, listBackups } from "@/server/services/backup";
import { type BackupRow, BackupsPanel } from "./backups-panel";

export const dynamic = "force-dynamic";

export default async function SauvegardesPage() {
  // Administration réservée aux administrateurs.
  await requireRole("administrateur");
  const [files, mode] = await Promise.all([listBackups(), getBackupMode()]);

  const rows: BackupRow[] = files.map((f) => ({
    name: f.name,
    kind: f.kind,
    size: f.size,
    mtime: f.mtime.toISOString(),
    encrypted: f.encrypted,
  }));

  return <BackupsPanel rows={rows} toolsAvailable={mode !== null} />;
}
