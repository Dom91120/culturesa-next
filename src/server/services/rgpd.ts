import type { Prisma } from "@/generated/prisma/client";
import { greeting } from "@/lib/mail-render";
import { getConfigMany } from "@/server/config";
import { prisma } from "@/server/db";
import { resolveEffectiveDemandeurId } from "@/server/services/bookings";
import { sendTemplatedMail } from "@/server/services/mail-send";
import { closeWaitingEntries } from "@/server/services/waiting-list";

type AnonymizeReason = "self_service" | "admin" | "retention";

/** Délai de grâce par défaut (jours) après préavis avant effacement, si config absente. */
const DEFAULT_GRACE_DAYS = 30;
/** Clé app_config du délai de grâce RGPD. */
const GRACE_DAYS_KEY = "rgpd.graceDays";
/** Durée de rétention par défaut (années) si la config est absente. */
const DEFAULT_RETENTION_YEARS = 3;
/** Clé app_config de la durée de rétention RGPD. */
const RETENTION_YEARS_KEY = "rgpd.retentionYears";

/** Erreur métier RGPD (message destiné à l'usager / l'admin). */
export class RgpdError extends Error {}

/**
 * Garde-fou « dernier administrateur actif » (port legacy `rgpd_has_other_active_admin`) :
 * lève `RgpdError` si `userId` est le SEUL administrateur non anonymisé restant. Empêche
 * d'anonymiser/supprimer le dernier admin, ce qui verrouillerait tout accès admin.
 * No-op si l'usager n'est pas administrateur (ou déjà anonymisé / introuvable).
 */
/**
 * Verrou consultatif sérialisant les opérations qui peuvent retirer un
 * administrateur (constat BAC6).
 *
 * « Compter les autres administrateurs puis agir » n'est pas atomique. En isolation
 * READ COMMITTED — le défaut de PostgreSQL —, deux administrateurs se rétrogradant
 * l'un l'autre au même instant peuvent chacun compter un autre administrateur encore
 * en place (celui que l'autre transaction n'a pas encore validé), passer tous deux le
 * contrôle et **n'en laisser aucun**. Le garde-fou produirait alors exactement le
 * verrouillage qu'il existe pour empêcher.
 *
 * ⚠️ **Entrelacement RAISONNÉ, non reproduit.** Une tentative de le provoquer — deux
 * transactions concurrentes rétrogradant chacune l'un des deux derniers
 * administrateurs — a donné le même résultat avec et sans ce verrou : les deux
 * transactions ne se sont pas chevauchées. Le verrou est donc conservé pour la
 * propriété qu'il garantit, non pour un défaut observé. Il coûte un aller-retour sur
 * des opérations rares (changement de rôle, anonymisation, suppression) ; le retirer
 * demanderait de démontrer que l'entrelacement est impossible, ce qui est plus
 * difficile que de le garder.
 *
 * Clé arbitraire mais FIXE — c'est elle, et non son sens, qui fait la sérialisation.
 */
const VERROU_DERNIER_ADMIN = 8471n;

export async function assertNotLastActiveAdmin(
  db: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  const u = await db.user.findUnique({
    where: { id: userId },
    select: { role: true, anonymizedAt: true },
  });
  // Ne concerne qu'un administrateur actif : sur tout autre compte, ce contrôle
  // n'a pas lieu d'être — et bloquerait la modification d'une fiche ordinaire.
  if (!u || u.anonymizedAt || u.role !== "administrateur") return;

  // Pris APRÈS le filtre ci-dessus : inutile de sérialiser les mises à jour qui ne
  // touchent aucun administrateur, c'est-à-dire l'immense majorité.
  await db.$executeRaw`SELECT pg_advisory_xact_lock(${VERROU_DERNIER_ADMIN})`;

  const others = await db.user.count({
    where: { role: "administrateur", anonymizedAt: null, id: { not: userId } },
  });
  if (others === 0) {
    throw new RgpdError("Action impossible : c'est le dernier administrateur actif du système.");
  }
}

/**
 * Anonymisation RGPD d'un compte (≠ suppression).
 *
 * Remplace les données personnelles identifiantes par des valeurs neutres,
 * dissocie le compte de sa structure, supprime les
 * sessions (déconnexion immédiate) ET les comptes d'authentification (mot de
 * passe) — sans quoi l'ancien titulaire pouvait se reconnecter avec l'e-mail
 * anonymisé prévisible `anonyme-<id>@…` et son mot de passe conservé (audit
 * 2026-07-19) — puis journalise l'opération dans `RgpdLog`.
 *
 * Les réservations ne sont PAS supprimées : l'historique métier est conservé,
 * mais rattaché à un compte désormais non identifiable. La CATÉGORIE
 * (`demandeurId`) est également conservée : ce n'est pas une donnée personnelle
 * et elle reste nécessaire à la lecture des statistiques par type de demandeur.
 *
 * Idempotent : si le compte est déjà anonymisé (`anonymizedAt` non null), no-op.
 */
export async function anonymizeUser(userId: string, reason: AnonymizeReason): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, anonymizedAt: true },
    });
    if (!user || user.anonymizedAt) return; // introuvable ou déjà anonymisé → no-op

    // Garde-fou : ne jamais anonymiser le dernier administrateur actif.
    await assertNotLastActiveAdmin(tx, userId);

    const now = new Date();

    // Liste d'attente : plus de destinataire ni de réservation possible → inscriptions
    // clôturées dans l'historique (libellés figés AVANT la mise à blanc de la fiche), puis
    // historique détaché du compte (userId NULL) — les libellés restent pour les stats.
    await closeWaitingEntries(tx, { userId }, "ANONYMIZED");
    await tx.waitingListLog.updateMany({ where: { userId }, data: { userId: null } });

    await tx.user.update({
      where: { id: userId },
      data: {
        // E-mail unique non identifiant (l'unicité de la colonne est préservée).
        email: `anonyme-${userId}@anonymise.local`,
        name: "",
        prenom: "",
        nom: "",
        tel: "",
        niveau: "",
        enfants: 0,
        accompagnants: 0,
        // `demandeurId` (catégorie) VOLONTAIREMENT conservé — cf. en-tête.
        structureId: null,
        rgpdOk: false,
        anonymizedAt: now,
      },
    });

    // Motifs d'absence : texte libre saisi par le gestionnaire, potentiellement
    // sensible (« enfant malade »…) — vidé par minimisation ; l'historique métier
    // (pointage P/A, effectifs, thème) reste intact pour les statistiques.
    await tx.booking.updateMany({ where: { userId }, data: { pointageMotif: "" } });

    // Déconnexion : on révoque toutes les sessions actives.
    await tx.session.deleteMany({ where: { userId } });
    // Verrouillage : suppression des comptes d'authentification (identifiants/mot de
    // passe) — le compte anonymisé ne doit plus être connectable.
    await tx.account.deleteMany({ where: { userId } });

    await tx.rgpdLog.create({
      data: {
        action: "anonymize",
        targetUserId: userId,
        details: { reason },
        createdAt: now,
      },
    });
  });
}

/**
 * Suppression physique d'un compte VIDE — hygiène de la base (comptes de test,
 * spam d'inscription), PAS la voie RGPD normale (= `anonymizeUser`).
 *
 * Refusée (`RgpdError`) si le compte a au moins une réservation : un DELETE
 * emporterait l'historique métier par cascade (`bookings.userId`) et fausserait
 * les statistiques — ces comptes doivent être anonymisés. Le garde-fou
 * « dernier administrateur actif » s'applique aussi. Sessions, comptes auth et
 * services gérés partent par cascade ; l'opération est journalisée dans
 * `RgpdLog` (`hard_delete`, sans donnée nominative — la cible n'existe plus).
 */
export async function hardDeleteEmptyUser(
  userId: string,
  actorUserId: string | null,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new RgpdError("Compte introuvable.");

    const bookings = await tx.booking.count({ where: { userId } });
    if (bookings > 0) {
      throw new RgpdError(
        "Suppression impossible : ce compte a des réservations. Utilisez l'anonymisation (RGPD).",
      );
    }

    await assertNotLastActiveAdmin(tx, userId);

    await tx.user.delete({ where: { id: userId } });

    await tx.rgpdLog.create({
      data: {
        action: "hard_delete",
        targetUserId: userId,
        actorUserId,
        details: { reason: "empty_account" },
      },
    });
  });
}

// ════════════════════════════════════════════════════════════
//  Scan d'inactivité RGPD (admin)
//
//  Calque l'écran legacy "Administration > RGPD" : liste les comptes
//  `utilisateur` non anonymisés triés par inactivité décroissante, propose
//  l'envoi d'un préavis puis l'effacement (anonymisation) une fois le délai
//  de grâce écoulé. Règles métier identiques au PHP d'origine.
// ════════════════════════════════════════════════════════════

const MS_PER_DAY = 86_400_000;

/** Source de la « dernière activité » retenue pour un compte. */
type LastSeenSource = "connexion" | "réservation" | "création";

type InactiveUser = {
  id: string;
  nom: string;
  prenom: string;
  email: string;
  lastLoginAt: Date | null;
  lastBookingAt: Date | null;
  createdAt: Date;
  deletionNoticeSentAt: Date | null;
  /** Jours écoulés depuis la dernière activité (référence = maintenant). */
  daysInactive: number;
  /** Date de dernière activité retenue (max des trois sources). */
  lastSeen: Date;
  lastSeenSource: LastSeenSource;
};

/**
 * Dernière activité d'un compte = la plus récente parmi : dernière connexion,
 * dernière réservation, et à défaut date de création (toujours présente).
 * Reproduit `_rgpdLastSeen` du legacy.
 */
function computeLastSeen(
  lastLoginAt: Date | null,
  lastBookingAt: Date | null,
  createdAt: Date,
): { date: Date; source: LastSeenSource } {
  let best = createdAt;
  let source: LastSeenSource = "création";
  if (lastBookingAt && lastBookingAt.getTime() >= best.getTime()) {
    best = lastBookingAt;
    source = "réservation";
  }
  if (lastLoginAt && lastLoginAt.getTime() >= best.getTime()) {
    best = lastLoginAt;
    source = "connexion";
  }
  return { date: best, source };
}

/** Map userId → date de dernière réservation, via un seul agrégat groupBy. */
async function lastBookingMap(userIds: string[]): Promise<Map<string, Date | null>> {
  const rows = await prisma.booking.groupBy({
    by: ["userId"],
    where: userIds.length > 0 ? { userId: { in: userIds } } : undefined,
    _max: { createdAt: true },
  });
  const map = new Map<string, Date | null>();
  for (const r of rows) map.set(r.userId, r._max.createdAt);
  return map;
}

/**
 * Liste les comptes utilisateurs (rôle `utilisateur`, non anonymisés) avec leur
 * inactivité calculée, triés par inactivité décroissante.
 */
export async function listInactiveScan(): Promise<InactiveUser[]> {
  const users = await prisma.user.findMany({
    where: { role: "utilisateur", anonymizedAt: null },
    select: {
      id: true,
      nom: true,
      prenom: true,
      email: true,
      lastLoginAt: true,
      deletionNoticeSentAt: true,
      createdAt: true,
    },
  });

  const bookingByUser = await lastBookingMap(users.map((u) => u.id));
  const now = Date.now();

  const list: InactiveUser[] = users.map((u) => {
    const lastBookingAt = bookingByUser.get(u.id) ?? null;
    const { date: lastSeen, source } = computeLastSeen(u.lastLoginAt, lastBookingAt, u.createdAt);
    const daysInactive = Math.floor((now - lastSeen.getTime()) / MS_PER_DAY);
    return {
      id: u.id,
      nom: u.nom,
      prenom: u.prenom,
      email: u.email,
      lastLoginAt: u.lastLoginAt,
      lastBookingAt,
      createdAt: u.createdAt,
      deletionNoticeSentAt: u.deletionNoticeSentAt,
      daysInactive,
      lastSeen,
      lastSeenSource: source,
    };
  });

  list.sort((a, b) => b.daysInactive - a.daysInactive);
  return list;
}

// ════════════════════════════════════════════════════════════
//  RGPD limité à UN service (sous-onglet Paramètres › RGPD)
//
//  Calque la « Partie 1 » du legacy (_rgpdServiceUsers / _renderRgpdPart1) :
//  liste les usagers rattachés à ce service afin de permettre leur
//  export (art. 15) ou leur effacement (anonymisation).
// ════════════════════════════════════════════════════════════

/** Usager du service exposé au panneau RGPD (dates sérialisées côté page). */
type ServiceRgpdUser = {
  id: string;
  nom: string;
  prenom: string;
  email: string;
  /** Dernière activité (max connexion / réservation / création), ou null. */
  lastSeen: Date | null;
};

/**
 * Liste les usagers d'un service éligibles au traitement RGPD individuel.
 *
 * Critères (cf. legacy `_rgpdServiceUsers`) : rôle `utilisateur`, non
 * anonymisés, et dont le « demandeur effectif » appartient aux demandeurs
 * configurés pour ce service (`ServiceDemandeurSettings`).
 *
 * Demandeur effectif = `user.demandeurId` s'il existe, sinon le
 * `demandeurId` de la structure de l'usager (COALESCE legacy).
 *
 * `lastSeen` = max(dernière connexion, dernière réservation, création),
 * via la même logique que le scan d'inactivité (`computeLastSeen`).
 * Trié par nom puis prénom.
 */
export async function listServiceRgpdUsers(serviceId: string): Promise<ServiceRgpdUser[]> {
  // Demandeurs configurés pour ce service.
  const settings = await prisma.serviceDemandeurSettings.findMany({
    where: { serviceId },
    select: { demandeurId: true },
  });
  const configuredDemandeurIds = new Set(settings.map((s) => s.demandeurId));
  if (configuredDemandeurIds.size === 0) return [];

  // Usagers candidats : rôle utilisateur, non anonymisés. On récupère le
  // demandeur direct + le demandeur de la structure pour le COALESCE.
  const users = await prisma.user.findMany({
    where: { role: "utilisateur", anonymizedAt: null },
    select: {
      id: true,
      nom: true,
      prenom: true,
      email: true,
      lastLoginAt: true,
      createdAt: true,
      demandeurId: true,
      structure: { select: { demandeurId: true } },
    },
  });

  const eligible = users.filter((u) => {
    const demandeurId = resolveEffectiveDemandeurId(u);
    return demandeurId != null && configuredDemandeurIds.has(demandeurId);
  });

  const bookingByUser = await lastBookingMap(eligible.map((u) => u.id));

  const list: ServiceRgpdUser[] = eligible.map((u) => {
    const { date: lastSeen } = computeLastSeen(
      u.lastLoginAt,
      bookingByUser.get(u.id) ?? null,
      u.createdAt,
    );
    return { id: u.id, nom: u.nom, prenom: u.prenom, email: u.email, lastSeen };
  });

  list.sort((a, b) => a.nom.localeCompare(b.nom) || a.prenom.localeCompare(b.prenom));
  return list;
}

/**
 * Vérifie qu'un usager relève du périmètre RGPD d'AU MOINS UN des services donnés
 * (anti-IDOR des actions RGPD service : anonymisation, export). Mêmes critères que
 * `listServiceRgpdUsers` : rôle `utilisateur`, non anonymisé, et demandeur effectif
 * (direct, sinon celui de la structure) configuré pour le service
 * (`ServiceDemandeurSettings`). Liste de services vide → refus.
 */
export async function isUserInServicesRgpdScope(
  serviceIds: string[],
  userId: string,
): Promise<boolean> {
  if (serviceIds.length === 0 || !userId) return false;
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      anonymizedAt: true,
      demandeurId: true,
      structure: { select: { demandeurId: true } },
    },
  });
  if (u?.role !== "utilisateur" || u.anonymizedAt) return false;
  const demandeurId = resolveEffectiveDemandeurId(u);
  if (demandeurId == null) return false;
  const setting = await prisma.serviceDemandeurSettings.findFirst({
    where: { serviceId: { in: serviceIds }, demandeurId },
    select: { serviceId: true },
  });
  return setting != null;
}

/** Lit la durée de rétention configurée (années), bornée 0–3, défaut 3. */
export async function getRetentionYears(): Promise<number> {
  const cfg = await getConfigMany([RETENTION_YEARS_KEY]);
  const v = Number.parseInt(cfg[RETENTION_YEARS_KEY] ?? "", 10);
  if (!Number.isFinite(v) || v < 0 || v > 3) return DEFAULT_RETENTION_YEARS;
  return v;
}

/** Lit le délai de grâce configuré (jours), borné 1–365, défaut 30. */
export async function getGraceDays(): Promise<number> {
  const cfg = await getConfigMany([GRACE_DAYS_KEY]);
  const v = Number.parseInt(cfg[GRACE_DAYS_KEY] ?? "", 10);
  if (!Number.isFinite(v) || v < 1 || v > 365) return DEFAULT_GRACE_DAYS;
  return v;
}

/** Seuil d'inactivité en jours = années de rétention × 365. */
function thresholdDays(years: number): number {
  return years * 365;
}

/**
 * Envoie le préavis de suppression aux comptes éligibles SANS préavis encore
 * envoyé : pose `deletionNoticeSentAt`, journalise (`deletion_notice`) et tente
 * un e-mail. L'échec d'envoi n'empêche PAS le marquage.
 * Retourne le nombre de comptes effectivement traités.
 */
export async function markDeletionNotice(userIds: string[]): Promise<number> {
  if (userIds.length === 0) return 0;
  const years = await getRetentionYears();
  const minDays = thresholdDays(years);
  const graceDays = await getGraceDays();

  const users = await prisma.user.findMany({
    where: {
      id: { in: userIds },
      role: "utilisateur",
      anonymizedAt: null,
      deletionNoticeSentAt: null,
    },
    select: { id: true, email: true, nom: true, prenom: true, lastLoginAt: true, createdAt: true },
  });

  const bookingByUser = await lastBookingMap(users.map((u) => u.id));
  const now = Date.now();
  let processed = 0;

  for (const u of users) {
    const { date: lastSeen } = computeLastSeen(
      u.lastLoginAt,
      bookingByUser.get(u.id) ?? null,
      u.createdAt,
    );
    const daysInactive = Math.floor((now - lastSeen.getTime()) / MS_PER_DAY);
    if (daysInactive < minDays) continue; // re-vérification serveur : pas encore éligible

    const sentAt = new Date();
    await prisma.$transaction([
      prisma.user.update({ where: { id: u.id }, data: { deletionNoticeSentAt: sentAt } }),
      prisma.rgpdLog.create({
        data: {
          action: "deletion_notice",
          targetUserId: u.id,
          details: { graceDays },
          createdAt: sentAt,
        },
      }),
    ]);

    // Envoi best-effort : un échec SMTP ne doit pas annuler le marquage.
    const name = `${u.prenom} ${u.nom}`.trim() || u.email;
    try {
      const vars = {
        salutation: greeting(name),
        prenom: u.prenom?.trim() ?? "",
        annees: `${years} an(s)`,
        delai: `${graceDays} jours`,
      };
      await sendTemplatedMail({
        to: u.email,
        kind: "account_deletion_notice",
        vars,
        mode: "direct",
      });
    } catch {
      // SMTP indisponible : on ignore, le marquage du préavis reste valide.
    }

    processed += 1;
  }

  return processed;
}

/**
 * Anonymise les comptes réellement éligibles : inactivité ≥ seuil ET préavis
 * envoyé il y a ≥ délai de grâce. Re-vérifie ces conditions côté serveur avant
 * d'agir (la liste cliente ne fait pas foi). Délègue à `anonymizeUser`.
 * Retourne le nombre de comptes anonymisés.
 */
export async function anonymizeInactive(
  userIds: string[],
  actorUserId: string | null,
): Promise<number> {
  if (userIds.length === 0) return 0;
  const years = await getRetentionYears();
  const minDays = thresholdDays(years);
  const graceDays = await getGraceDays();

  const users = await prisma.user.findMany({
    where: {
      id: { in: userIds },
      role: "utilisateur",
      anonymizedAt: null,
      deletionNoticeSentAt: { not: null },
    },
    select: { id: true, deletionNoticeSentAt: true, lastLoginAt: true, createdAt: true },
  });

  const bookingByUser = await lastBookingMap(users.map((u) => u.id));
  const now = Date.now();
  let anonymized = 0;

  for (const u of users) {
    const { date: lastSeen } = computeLastSeen(
      u.lastLoginAt,
      bookingByUser.get(u.id) ?? null,
      u.createdAt,
    );
    const daysInactive = Math.floor((now - lastSeen.getTime()) / MS_PER_DAY);
    if (daysInactive < minDays) continue;

    const noticeAgeDays = u.deletionNoticeSentAt
      ? Math.floor((now - u.deletionNoticeSentAt.getTime()) / MS_PER_DAY)
      : -1;
    if (noticeAgeDays < graceDays) continue;

    await anonymizeUser(u.id, "retention");

    // Trace l'acteur sur la dernière entrée RgpdLog de ce compte (anonymizeUser
    // ne connaît pas l'admin déclencheur).
    if (actorUserId) {
      const last = await prisma.rgpdLog.findFirst({
        where: { action: "anonymize", targetUserId: u.id },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (last) await prisma.rgpdLog.update({ where: { id: last.id }, data: { actorUserId } });
    }
    anonymized += 1;
  }

  return anonymized;
}

/**
 * Tâche planifiée de rétention RGPD (cf. /api/cron/rgpd-retention). Automatise ce
 * que l'écran « Administration > RGPD » fait manuellement :
 *   1. envoie le préavis aux comptes inactifs ≥ seuil et sans préavis ;
 *   2. anonymise ceux dont le préavis date d'au moins le délai de grâce et qui sont
 *      toujours inactifs.
 * `markDeletionNotice` et `anonymizeInactive` re-vérifient l'éligibilité côté
 * serveur ; on leur passe donc simplement les candidats issus du scan. Acteur
 * `null` = système. Renvoie le nombre de préavis envoyés et de comptes anonymisés.
 */
export async function runRgpdRetention(): Promise<{ notified: number; anonymized: number }> {
  const scan = await listInactiveScan();
  const minDays = thresholdDays(await getRetentionYears());
  const graceDays = await getGraceDays();
  const now = Date.now();

  const noticeIds = scan
    .filter((u) => u.daysInactive >= minDays && !u.deletionNoticeSentAt)
    .map((u) => u.id);
  const notified = await markDeletionNotice(noticeIds);

  const anonIds = scan
    .filter(
      (u) =>
        u.deletionNoticeSentAt != null &&
        u.daysInactive >= minDays &&
        Math.floor((now - u.deletionNoticeSentAt.getTime()) / MS_PER_DAY) >= graceDays,
    )
    .map((u) => u.id);
  const anonymized = await anonymizeInactive(anonIds, null);

  return { notified, anonymized };
}
