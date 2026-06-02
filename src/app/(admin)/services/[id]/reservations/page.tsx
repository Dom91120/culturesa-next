import { getService } from "@/server/services/services";
import { notFound } from "next/navigation";
import { ParamsSubnav } from "../params-subnav";
import { ReservationsPanel } from "./reservations-panel";

export default async function ReservationsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const service = await getService(id);
  if (!service) notFound();

  return (
    <div>
      <ParamsSubnav serviceId={id} />
      <ReservationsPanel
        serviceId={id}
        maxReservations={service.maxReservations}
        maxReservationsPeriod={service.maxReservationsPeriod}
        bookingDelay={service.bookingDelay}
        autoValidationDelay={service.autoValidationDelay}
        validationBloquante={service.validationBloquante}
      />
    </div>
  );
}
