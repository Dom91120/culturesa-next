"use client";

import { ServicesEditor } from "../services/services-editor";
import { ReferentielEntry } from "./referentiel-entry";

type ServiceRow = { id: string; label: string; icon: string | null; contactEmail: string | null };

/** Entrée « Services » du panneau Référentiels (modale + `ServicesEditor`, mode tampon). */
export function ServicesReferentiel({ services }: { services: ServiceRow[] }) {
  return (
    <ReferentielEntry title="Services" subtitle="Référentiel des services">
      {(close) => <ServicesEditor initial={services} onClose={close} />}
    </ReferentielEntry>
  );
}
