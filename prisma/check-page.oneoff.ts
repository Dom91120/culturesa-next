/** One-shot : reproduit les requêtes de PeriodesPage hors Next. */
import "dotenv/config";
import { getServiceOpeningConfig, listServicePeriods } from "@/server/services/periods";
import { getService } from "@/server/services/services";

async function main() {
  const service = await getService("svc_005");
  console.log("getService:", service ? `OK (${service.label})` : "NULL !!");
  const { periods, exercices } = await listServicePeriods("svc_005");
  console.log("periods:", periods.length, "exercices:", exercices.length);
  const opening = await getServiceOpeningConfig("svc_005");
  console.log("opening:", opening ? "OK" : "NULL");
  console.log("exercice[0] overrides:", JSON.stringify(exercices[0], null, 0).slice(0, 300));
}

main().then(() => process.exit(0));
