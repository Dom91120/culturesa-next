import { notFound } from "next/navigation";
import { getRetentionYears, listServiceRgpdUsers } from "@/server/services/rgpd";
import { getService } from "@/server/services/services";
import { ParamsSubnav } from "../params-subnav";
import { ServiceRgpdPanel } from "./service-rgpd-panel";

export default async function ServiceRgpdPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const service = await getService(id);
  if (!service) notFound();

  const [users, retentionYears] = await Promise.all([
    listServiceRgpdUsers(id),
    getRetentionYears(),
  ]);

  // Sérialisation des dates pour la frontière serveur → client.
  const rows = users.map((u) => ({
    id: u.id,
    nom: u.nom,
    prenom: u.prenom,
    email: u.email,
    lastSeen: u.lastSeen ? u.lastSeen.toISOString() : null,
  }));

  return (
    <div>
      <ParamsSubnav serviceId={id} />
      <ServiceRgpdPanel
        serviceId={id}
        users={rows}
        retentionYears={retentionYears}
        generatedAt={new Date().toISOString()}
      />
    </div>
  );
}
