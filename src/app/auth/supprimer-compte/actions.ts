"use server";

import {
  type ConfirmDeletionResult,
  confirmAccountDeletion,
} from "@/server/services/account-deletion";

/**
 * Confirme la suppression du compte à partir du token signé reçu par e-mail. Le
 * token (et lui seul) autorise l'opération — aucune session requise.
 */
export async function confirmAccountDeletionAction(token: string): Promise<ConfirmDeletionResult> {
  return confirmAccountDeletion(token);
}
