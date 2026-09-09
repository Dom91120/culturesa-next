"use client";

import { StoreGlyph } from "@/components/ui-glyphs";

import { ServicesEditor } from "../services/services-editor";
import { ReferentielEntry } from "./referentiel-entry";

type ServiceRow = {
  id: string;
  label: string;
  icon: string | null;
  contactEmail: string | null;
  managers: number;
};

/** Entrée « Services » du panneau Référentiels (modale + `ServicesEditor`, mode tampon). */
export function ServicesReferentiel({ services }: { services: ServiceRow[] }) {
  const sansContact = services.filter((s) => !s.contactEmail?.trim()).length;
  return (
    <ReferentielEntry
      title="Services"
      icon={
        <span className="rg-ico is-ok">
          <StoreGlyph size={14} />
        </span>
      }
      count={services.length}
      subtitle="Nom, icône et e-mail de contact de chaque service. Les réglages du service (créneaux, périodes, e-mails) se font dans ses Paramètres."
      detail={
        sansContact === 0
          ? "tous ont un e-mail de contact"
          : `${sansContact} sans e-mail de contact`
      }
    >
      {(close) => <ServicesEditor initial={services} onClose={close} />}
    </ReferentielEntry>
  );
}
