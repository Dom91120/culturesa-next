import Link from "next/link";
import { Card, PageTitle } from "@/components/ui";
import { listBookableServices } from "@/server/services/bookings";

export default async function ReserverPage() {
  const services = await listBookableServices();

  return (
    <div className="space-y-6">
      <PageTitle>Réserver une activité</PageTitle>

      {services.length === 0 && (
        <Card>
          <p className="text-sm text-neutral-400">Aucune activité disponible pour le moment.</p>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {services.map((s) => (
          <Link key={s.id} href={`/reserver/${s.id}`} className="block">
            <Card>
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-brand-700">{s.label}</h2>
                {s.icon && <span className="text-xl">{s.icon}</span>}
              </div>
              <p className="mt-2 text-sm text-neutral-500">
                {s._count.slots > 0
                  ? `${s._count.slots} créneau${s._count.slots > 1 ? "x" : ""} à venir`
                  : "Aucun créneau à venir"}
              </p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
