import Link from "next/link";
import { notFound } from "next/navigation";
import { btnDanger, btnGhost, Card, inputClass, PageTitle } from "@/components/ui";
import { toDateInput } from "@/lib/format";
import { prisma } from "@/server/db";
import { listPeriods } from "@/server/services/periods";
import { getService } from "@/server/services/services";
import { listSlotsForService } from "@/server/services/slots";
import { deleteServiceAction } from "../actions";
import { ServiceForm } from "./service-form";
import { SlotCreateForm } from "./slot-create-form";
import { SlotDemandeurs } from "./slot-demandeurs";
import { deleteSlotAction, updateSlotAction } from "./slot-actions";

const DAY_CAP_FIELDS = [
  { key: "lun", field: "capLun", label: "Lun" },
  { key: "mar", field: "capMar", label: "Mar" },
  { key: "mer", field: "capMer", label: "Mer" },
  { key: "jeu", field: "capJeu", label: "Jeu" },
  { key: "ven", field: "capVen", label: "Ven" },
  { key: "sam", field: "capSam", label: "Sam" },
  { key: "dim", field: "capDim", label: "Dim" },
] as const;

export default async function ServiceConfigPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const service = await getService(id);
  if (!service) notFound();

  const [slots, allPeriods, demandeurs] = await Promise.all([
    listSlotsForService(id),
    listPeriods(),
    prisma.demandeur.findMany({ orderBy: { label: "asc" }, select: { id: true, label: true } }),
  ]);
  // Périodes utilisables : globales (sans service) ou propres à ce service.
  const periodOptions = allPeriods
    .filter((p) => p.serviceId === null || p.serviceId === id)
    .map((p) => ({ id: p.id, label: p.label }));
  const activeDays = new Set(service.activeDays.split(",").map((d) => d.trim()).filter(Boolean));
  const dayCapFields = DAY_CAP_FIELDS.filter((d) => activeDays.has(d.key));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <PageTitle>{service.label}</PageTitle>
        <Link href="/services" className="text-sm text-neutral-500 hover:text-brand-700">
          ← Tous les services
        </Link>
      </div>

      <Card>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-neutral-400">
          Configuration
        </h2>
        <ServiceForm service={service} />
      </Card>

      <Card>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-neutral-400">
          Créneaux
        </h2>
        <div className="mb-5 border-b border-neutral-100 pb-5 dark:border-neutral-800">
          <SlotCreateForm serviceId={id} periods={periodOptions} />
        </div>

        <div className="space-y-3">
          {slots.map((slot) => (
            <div
              key={slot.id}
              className="flex flex-wrap items-end gap-3 rounded-md border border-neutral-100 p-3 dark:border-neutral-800"
            >
              <form action={updateSlotAction} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="id" value={slot.id} />
                <input type="hidden" name="serviceId" value={id} />
                <label className="text-xs">
                  <span className="mb-1 block font-medium text-neutral-500">Type</span>
                  <select name="slotType" defaultValue={slot.slotType} className={inputClass}>
                    <option value="recurring">Récurrent</option>
                    <option value="unique">Ponctuel</option>
                  </select>
                </label>
                <label className="text-xs">
                  <span className="mb-1 block font-medium text-neutral-500">Date</span>
                  <input name="slotDate" type="date" defaultValue={toDateInput(slot.slotDate)} className={inputClass} />
                </label>
                <label className="text-xs">
                  <span className="mb-1 block font-medium text-neutral-500">Début</span>
                  <input name="startTime" type="time" defaultValue={slot.startTime} className={inputClass} />
                </label>
                <label className="text-xs">
                  <span className="mb-1 block font-medium text-neutral-500">Fin</span>
                  <input name="endTime" type="time" defaultValue={slot.endTime} className={inputClass} />
                </label>
                <label className="text-xs">
                  <span className="mb-1 block font-medium text-neutral-500">Capacité</span>
                  <input name="capacity" type="number" min={0} defaultValue={slot.capacity ?? ""} className={`${inputClass} w-24`} />
                </label>
                {slot.slotType === "recurring" &&
                  dayCapFields.map((d) => (
                    <label key={d.field} className="text-xs" title={`Capacité ${d.label} (sinon capacité par défaut)`}>
                      <span className="mb-1 block font-medium text-neutral-500">{d.label}</span>
                      <input
                        name={d.field}
                        type="number"
                        min={0}
                        defaultValue={(slot[d.field as keyof typeof slot] as number | null) ?? ""}
                        className={`${inputClass} w-14`}
                      />
                    </label>
                  ))}
                <label className="text-xs">
                  <span className="mb-1 block font-medium text-neutral-500">Période</span>
                  <select name="periodId" defaultValue={slot.periodId ?? ""} className={inputClass}>
                    <option value="">— aucune —</option>
                    {periodOptions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs">
                  <span className="mb-1 block font-medium text-neutral-500">État</span>
                  <select name="state" defaultValue={slot.state} className={inputClass}>
                    <option value="actif">Actif</option>
                    <option value="desactive">Désactivé</option>
                    <option value="archive">Archivé</option>
                  </select>
                </label>
                <button type="submit" className={btnGhost}>
                  Enregistrer
                </button>
              </form>
              <form action={deleteSlotAction}>
                <input type="hidden" name="id" value={slot.id} />
                <input type="hidden" name="serviceId" value={id} />
                <button type="submit" className={btnDanger}>
                  Supprimer
                </button>
              </form>
              {slot.slotType === "recurring" && (
                <SlotDemandeurs
                  slotId={slot.id}
                  serviceId={id}
                  demandeurs={demandeurs}
                  allowedIds={slot.demandeurs.map((d) => d.demandeurId)}
                />
              )}
            </div>
          ))}
          {slots.length === 0 && <p className="text-sm text-neutral-400">Aucun créneau pour ce service.</p>}
        </div>
      </Card>

      <form action={deleteServiceAction} style={{ marginTop: ".5rem" }}>
        <input type="hidden" name="id" value={id} />
        <button type="submit" className="btn btn-ghost" style={{ borderColor: "rgba(224,107,107,.4)", color: "var(--danger)" }}>
          🗑️ Supprimer ce service
        </button>
      </form>
    </div>
  );
}
