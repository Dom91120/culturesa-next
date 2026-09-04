import { requireRole } from "@/server/guards";
import { getValidationNoticeDelay } from "@/server/services/validation-notice";
import { EchangesAdminTabs } from "./echanges-tabs";
import {
  getGlobalModeleRows,
  getKindOptions,
  getMailRows,
  getRoutingRows,
  SYSTEM_MAIL_KINDS,
} from "./mail-rows";

// Onglet « Échanges » (administration), GLOBAL, en deux sous-onglets :
//  - « Échanges par mail » : routage action → type d'e-mail + destinataire + envoi (communs à
//    tous les services) ;
//  - « Modèles d'e-mails » : contenu de tous les e-mails (système + réservation + perso globaux),
//    surchargeable par service dans les Paramètres de chaque service.
export default async function EchangesAdminPage() {
  // Réservé aux administrateurs (les gestionnaires gèrent le contenu des modèles de leurs services).
  await requireRole("administrateur");

  const [routingRows, kindOptions, autoMailRows, globalModeleRows, validationNoticeDelay] =
    await Promise.all([
      getRoutingRows(),
      getKindOptions(),
      getMailRows(SYSTEM_MAIL_KINDS),
      getGlobalModeleRows(),
      getValidationNoticeDelay(),
    ]);
  // Système d'abord (toujours envoyés), puis réservation (intégrés + globaux personnalisés).
  const modeleRows = [...autoMailRows, ...globalModeleRows];

  return (
    <EchangesAdminTabs
      routingRows={routingRows}
      kindOptions={kindOptions}
      modeleRows={modeleRows}
      validationNoticeDelay={validationNoticeDelay}
    />
  );
}
