"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { AUDIT, recordAudit } from "@/server/audit";
import { requireRole } from "@/server/guards";
import { createBackup, deleteBackup, restoreBackup } from "@/server/services/backup";

/** Crée un export manuel de la base (pg_dump). */
export async function createBackupAction(): Promise<ActionState> {
  await requireRole("administrateur");
  try {
    const f = await createBackup();
    await recordAudit(AUDIT.BACKUP_CREATED, { target: f.name });
    revalidatePath("/taches-planifiees/exports");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Échec de l'export." };
  }
}

/** Restaure la base à partir d'un dump du dossier de sauvegardes. IRRÉVERSIBLE. */
export async function restoreBackupAction(name: string): Promise<ActionState> {
  await requireRole("administrateur");
  try {
    await restoreBackup(name);
    // Remplacement COMPLET de la base : l acte le plus destructeur de l app.
    await recordAudit(AUDIT.BACKUP_RESTORED, { target: name });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Échec de la restauration." };
  }
}

/** Supprime un dump du dossier de sauvegardes. */
export async function deleteBackupAction(name: string): Promise<ActionState> {
  await requireRole("administrateur");
  try {
    await deleteBackup(name);
    await recordAudit(AUDIT.BACKUP_DELETED, { target: name });
    revalidatePath("/taches-planifiees/exports");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Échec de la suppression." };
  }
}
