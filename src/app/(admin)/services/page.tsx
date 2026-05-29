import Link from "next/link";
import { btnDanger, btnGhost, Card, PageTitle } from "@/components/ui";
import { listServices } from "@/server/services/services";
import { deleteServiceAction } from "./actions";
import { CreateServiceForm } from "./create-form";

export default async function ServicesPage() {
  const services = await listServices();

  return (
    <div className="space-y-6">
      <PageTitle>Services</PageTitle>

      <Card>
        <CreateServiceForm />
      </Card>

      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-neutral-500 dark:border-neutral-800">
              <th className="pb-2 font-medium">Libellé</th>
              <th className="pb-2 font-medium">Contenu</th>
              <th className="pb-2 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {services.map((s) => (
              <tr key={s.id} className="border-b border-neutral-100 dark:border-neutral-800/60">
                <td className="py-2 pr-3">
                  <Link href={`/services/${s.id}`} className="font-medium text-brand-700 hover:underline">
                    {s.label}
                  </Link>
                  <span className="ml-2 text-xs text-neutral-400">{s.id}</span>
                </td>
                <td className="py-2 pr-3 text-neutral-500">
                  {s._count.slots} créneaux · {s._count.periods} périodes · {s._count.bookings} résa.
                </td>
                <td className="py-2">
                  <div className="flex justify-end gap-2">
                    <Link href={`/services/${s.id}`} className={btnGhost}>
                      Configurer
                    </Link>
                    <form action={deleteServiceAction}>
                      <input type="hidden" name="id" value={s.id} />
                      <button type="submit" className={btnDanger}>
                        Supprimer
                      </button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
            {services.length === 0 && (
              <tr>
                <td colSpan={3} className="py-6 text-center text-neutral-400">
                  Aucun service.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
