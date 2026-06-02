import { listServices } from "@/server/services/services";
import { ServicesManager } from "./services-manager";

export default async function ServicesPage() {
  const services = await listServices();

  return (
    <ServicesManager services={services.map((s) => ({ id: s.id, label: s.label, icon: s.icon }))} />
  );
}
