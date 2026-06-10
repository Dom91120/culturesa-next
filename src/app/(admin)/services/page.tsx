import { listServicesForCurrentAdmin } from "@/server/services/services";
import { ServicesManager } from "./services-manager";

export default async function ServicesPage() {
  // Un gestionnaire ne voit que les services qu'il gère ; un administrateur, tous.
  const services = await listServicesForCurrentAdmin();

  return (
    <ServicesManager services={services.map((s) => ({ id: s.id, label: s.label, icon: s.icon }))} />
  );
}
