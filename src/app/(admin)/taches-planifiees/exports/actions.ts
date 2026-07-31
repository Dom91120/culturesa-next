"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { AUDIT, recordAudit } from "@/server/audit";
import { messageClient } from "@/server/errors";
import { requireRole } from "@/server/guards";
import { reauthOrError } from "@/server/reauth";
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
    return { ok: false, error: messageClient(e, "Échec de l'export.", "backup:create") };
  }
}

/** Restaure la base à partir d'un dump du dossier de sauvegardes. IRRÉVERSIBLE. */
export async function restoreBackupAction(name: string, password: string): Promise<ActionState> {
  await requireRole("administrateur");
  // Remplacement COMPLET de la base : l'acte le plus destructeur de l'application
  // (constat BAC3). Un cookie de session ne suffit pas à le déclencher.
  const refus = await reauthOrError(password);
  if (refus) return refus;
  try {
    await restoreBackup(name);
    // Remplacement COMPLET de la base : l acte le plus destructeur de l app.
    await recordAudit(AUDIT.BACKUP_RESTORED, { target: name });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: messageClient(e, "Échec de la restauration.", "backup:restore") };
  }
}

/** Supprime un dump du dossier de sauvegardes. */
// Volontairement SANS ré-authentification, contrairement à la restauration : c'est
// de l'entretien courant, et multiplier les demandes de mot de passe apprend à le
// saisir machinalement — ce qui vide la confirmation de son sens là où elle compte.
// La suppression reste tracée au journal d'audit (constat BAC4).
export async function deleteBackupAction(name: string): Promise<ActionState> {
  await requireRole("administrateur");
  try {
    await deleteBackup(name);
    await recordAudit(AUDIT.BACKUP_DELETED, { target: name });
    revalidatePath("/taches-planifiees/exports");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: messageClient(e, "Échec de la suppression.", "backup:delete") };
  }
}
