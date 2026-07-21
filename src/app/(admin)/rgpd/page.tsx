import { DATETIME_FMT_FR as dtFmt } from "@/lib/format";
import { prisma } from "@/server/db";
import { requireRole } from "@/server/guards";
import { getGraceDays, getRetentionYears, listInactiveScan } from "@/server/services/rgpd";
import { type AuditEntry, AuditLog, type AuditParty } from "./audit-log";
import { type InactiveRow, InactivityScan } from "./inactivity-scan";

export default async function RgpdAdminPage() {
  // Administration réservée aux administrateurs (les gestionnaires n'y ont pas accès).
  await requireRole("administrateur");
  const [logs, scan, retentionYears, graceDays] = await Promise.all([
    prisma.rgpdLog.findMany({ orderBy: { createdAt: "desc" }, take: 500 }),
    listInactiveScan(),
    getRetentionYears(),
    getGraceDays(),
  ]);

  // Seuls les usagers cités (cible/acteur) par les logs chargés sont nécessaires à la
  // résolution — pas toute la table. RgpdLog n'a pas de FK : un id peut ne plus exister,
  // resolveParty gère ce cas (repli).
  const referencedIds = [
    ...new Set(
      logs.flatMap((l) => [l.targetUserId, l.actorUserId]).filter((id): id is string => !!id),
    ),
  ];
  const users = referencedIds.length
    ? await prisma.user.findMany({
        where: { id: { in: referencedIds } },
        select: { id: true, nom: true, prenom: true, email: true, anonymizedAt: true },
      })
    : [];

  // Sérialisation Date → ISO pour le composant client.
  const scanRows: InactiveRow[] = scan.map((u) => ({
    id: u.id,
    nom: u.nom,
    prenom: u.prenom,
    email: u.email,
    deletionNoticeSentAt: u.deletionNoticeSentAt ? u.deletionNoticeSentAt.toISOString() : null,
    daysInactive: u.daysInactive,
    lastSeen: u.lastSeen.toISOString(),
    lastSeenSource: u.lastSeenSource,
  }));

  // Résolution cible/acteur : "Nom Prénom" + email + état anonymisé.
  const partyById = new Map<string, AuditParty>(
    users.map((u) => [
      u.id,
      {
        id: u.id,
        name: `${u.nom} ${u.prenom}`.trim(),
        email: u.email,
        anonymized: u.anonymizedAt != null,
      },
    ]),
  );
  const resolveParty = (id: string | null): AuditParty => {
    if (id == null) return null;
    return partyById.get(id) ?? { id, name: "", email: "", anonymized: false };
  };

  const auditEntries: AuditEntry[] = logs.map((l) => ({
    id: l.id,
    dateLabel: dtFmt.format(l.createdAt),
    action: l.action,
    target: resolveParty(l.targetUserId),
    actor: resolveParty(l.actorUserId),
    ip: l.ip,
  }));

  return (
    <div>
      <img
        src="/RGPD.png"
        alt="Logo RGPD"
        style={{ display: "block", height: 100, width: "auto", margin: "1.5rem 0" }}
      />

      <InactivityScan rows={scanRows} retentionYears={retentionYears} graceDays={graceDays} />

      <AuditLog entries={auditEntries} />
    </div>
  );
}
