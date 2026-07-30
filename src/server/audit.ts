import { headers } from "next/headers";
import type { Role } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { getSession } from "@/server/guards";

// ════════════════════════════════════════════════════════════════════════════
//  Journal des actions privilégiées (constat BAC4).
//
//  Avant : seuls l'export et l'anonymisation RGPD laissaient une trace. Un
//  changement de RÔLE, une restauration de sauvegarde, une modification des
//  identifiants SMTP ou la suppression d'un service ne laissaient rien —
//  c'est-à-dire précisément ce qu'on cherche à reconstituer après un incident.
//
//  ── Ce qui est journalisé ──
//  Les actes PRIVILÉGIÉS : élévation, destruction, accès à des données en masse,
//  modification de secrets. Pas l'activité courante (créer une réservation,
//  éditer un créneau) : un journal noyé sous le bruit ne se lit pas, et
//  conserver l'activité ordinaire des usagers serait disproportionné.
//
//  ── L'écriture ne doit JAMAIS faire échouer l'action ──
//  Un journal indisponible ne doit pas empêcher un administrateur de travailler.
//  Toutes les fonctions sont donc best-effort. C'est un compromis assumé : on
//  privilégie la disponibilité sur la garantie de traçabilité. Un dispositif
//  exigeant l'inverse (refuser l'acte si le journal est muet) supposerait une
//  contrainte réglementaire qui n'existe pas ici.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Actions journalisées. Le libellé est un identifiant STABLE : il est stocké en
 * base et sert de clé de lecture. Le renommer casserait l'historique — ajouter
 * plutôt une nouvelle valeur.
 */
export const AUDIT = {
  // ── Comptes et privilèges ──
  USER_ROLE_CHANGED: "user.role_changed",
  USER_CREATED: "user.created",
  USER_UPDATED: "user.updated",
  USER_DELETED: "user.deleted",
  USER_PASSWORD_RESET_SENT: "user.password_reset_sent",
  // ── Sauvegardes ──
  BACKUP_CREATED: "backup.created",
  BACKUP_RESTORED: "backup.restored",
  BACKUP_DELETED: "backup.deleted",
  BACKUP_DOWNLOADED: "backup.downloaded",
  BACKUP_UPLOADED: "backup.uploaded",
  // ── Configuration sensible ──
  MAIL_CONFIG_CHANGED: "config.mail_changed",
  // ── Destructions métier ──
  SERVICE_DELETED: "service.deleted",
} as const;

export type AuditAction = (typeof AUDIT)[keyof typeof AUDIT];

/** Durée de conservation du journal. Purgé par la tâche de rétention. */
export const AUDIT_RETENTION_DAYS = 730; // 2 ans

/**
 * Enregistre une action privilégiée. L'acteur et l'IP sont résolus ici : les
 * appelants n'ont pas à y penser, et ne peuvent donc pas se tromper d'acteur.
 *
 * `target` : identifiant LISIBLE de la cible (adresse de l'usager visé, nom du
 * fichier, libellé du service) — pas un identifiant technique, que personne ne
 * saura interpréter deux ans plus tard en lisant le journal.
 */
export async function recordAudit(
  action: AuditAction,
  opts: { target?: string | null; details?: Record<string, unknown> } = {},
): Promise<void> {
  try {
    const session = await getSession();
    const user = session?.user as { id?: string; email?: string; role?: Role } | undefined;
    // IP transmise par le proxy de confiance : entrée la plus À DROITE, les
    // précédentes étant fournies par le client (même règle que src/proxy.ts).
    const ip = (await headers()).get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? null;

    await prisma.auditLog.create({
      data: {
        action,
        actorId: user?.id ?? null,
        // Dénormalisé : le journal doit rester lisible même si le compte
        // disparaît ou est anonymisé ensuite.
        actorLabel: user?.email ?? "(système)",
        actorRole: user?.role ?? "",
        target: opts.target ?? null,
        details: opts.details ? (opts.details as object) : undefined,
        ip,
      },
    });
  } catch (e) {
    // Volontairement silencieux vis-à-vis de l'appelant : journaliser est
    // important, mais moins que de laisser l'administrateur faire son travail.
    console.error("[audit] écriture impossible:", action, e);
  }
}

/** Purge les entrées au-delà de la durée de conservation. */
export async function purgeOldAuditEntries(): Promise<number> {
  const cutoff = new Date(Date.now() - AUDIT_RETENTION_DAYS * 24 * 60 * 60_000);
  const { count } = await prisma.auditLog.deleteMany({ where: { at: { lt: cutoff } } });
  return count;
}
