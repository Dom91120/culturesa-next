import { prisma } from "@/server/db";
import { getRetentionYears, listInactiveScan } from "@/server/services/rgpd";
import { type AuditEntry, AuditLog, type AuditParty } from "./audit-log";
import { type InactiveRow, InactivityScan } from "./inactivity-scan";

const dtFmt = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export default async function RgpdAdminPage() {
  const [logs, scan, retentionYears] = await Promise.all([
    prisma.rgpdLog.findMany({ orderBy: { createdAt: "desc" }, take: 500 }),
    listInactiveScan(),
    getRetentionYears(),
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
      <InactivityScan rows={scanRows} retentionYears={retentionYears} />

      <AuditLog entries={auditEntries} />
    </div>
  );
}
