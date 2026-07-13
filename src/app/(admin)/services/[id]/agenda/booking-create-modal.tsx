"use client";

import { useState } from "react";
import { ModalOverlay } from "@/components/agenda-shared";
import { DAY_NAMES } from "@/lib/agenda-core";
import { plural } from "./agenda-format";
import { OccurrencesField } from "./occurrences-field";

// Usager proposé dans la modale (chargé à la demande par le parent via
// listAgendaUsersAction) ; openOnSchoolHolidays sert au calcul des occurrences.
export type UserOpt = {
  id: string;
  label: string;
  demandeur?: string;
  structure?: string;
  openOnSchoolHolidays?: boolean;
};

// Cible de la création (créneau + jour cliqués) — variante NON nulle du CreateCtx
// du parent (la modale n'est montée que quand une cible existe).
export type CreateTarget = {
  dayKey: string;
  slotId: string;
  // Créneau ponctuel : réservation ponctuelle (pas de période / jour) + date affichée.
  ponctuel?: boolean;
  slotDate?: string;
};

/**
 * Modale « ➕ Nouvelle réservation » de la grille admin (port legacy pcm-*).
 * L'état du FORMULAIRE (cascade Type de demandeur → Structure → Demandeur,
 * compteurs, thème, erreur) vit ici — le parent monte la modale à la demande
 * (l'état repart donc vierge à chaque ouverture) et garde : le chargement des
 * usagers, le calcul des occurrences (occurrenceDatesFor) et l'envoi serveur
 * (onSubmit ferme la modale côté parent en cas de succès).
 */
export function BookingCreateModal({
  ctx,
  createSlot,
  period,
  users,
  serviceDemandeurs,
  themeMode,
  themesListMode,
  themes,
  occurrenceDatesFor,
  onSubmit,
  onClose,
}: {
  ctx: CreateTarget;
  createSlot: { startTime: string; endTime: string } | null;
  period: { etiquette: string; label: string; color: string } | null;
  users: UserOpt[];
  serviceDemandeurs: { id: number; label: string }[];
  themeMode: boolean;
  themesListMode: boolean;
  themes: string[];
  // « Créneaux concernés » (récurrent) : occurrences effectivement créées pour
  // l'usager sélectionné (vacances scolaires du demandeur incluses dans le calcul).
  occurrenceDatesFor: (selUser: UserOpt | undefined) => string[];
  onSubmit: (form: {
    userId: string;
    enfants: number;
    accompagnants: number;
    theme: string;
  }) => Promise<{ ok: boolean; error?: string | null }>;
  onClose: () => void;
}) {
  const [cUser, setCUser] = useState("");
  // Filtres « Type de demandeur » et « Structure » (modale legacy) : restreignent la liste des usagers.
  const [cDemType, setCDemType] = useState("");
  const [cStructure, setCStructure] = useState("");
  const [cEnfants, setCEnfants] = useState("0");
  const [cAccompagnants, setCAccompagnants] = useState("0");
  const [cTheme, setCTheme] = useState("");
  const [cError, setCError] = useState<string | null>(null);

  function submit() {
    if (!cUser) {
      setCError("Choisissez un usager.");
      return;
    }
    void onSubmit({
      userId: cUser,
      enfants: Number(cEnfants) || 0,
      accompagnants: Number(cAccompagnants) || 0,
      theme: cTheme,
    }).then((res) => {
      if (!res.ok) setCError(res.error ?? "Échec.");
    });
  }

  // Liste des usagers filtrée par « Type de demandeur » puis « Structure »
  // (cascade, port legacy onPcmDemandeurChange / onPcmStructureChange).
  const usersByType = cDemType ? users.filter((u) => u.demandeur === cDemType) : users;
  const structureOptions = [
    ...new Set(usersByType.map((u) => u.structure).filter(Boolean)),
  ].sort() as string[];
  const createUsers = cStructure
    ? usersByType.filter((u) => u.structure === cStructure)
    : usersByType;
  const nCEnf = Number(cEnfants) || 0;
  const nCAcc = Number(cAccompagnants) || 0;
  // Pastille de période (étiquette · libellé) dans le titre, avant le jour.
  const periodTag = period ? [period.etiquette, period.label].filter(Boolean).join(" · ") : "";
  const dayHour =
    (ctx.ponctuel
      ? ctx.slotDate
        ? new Date(`${ctx.slotDate}T00:00:00`).toLocaleDateString("fr-FR", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })
        : "créneau ponctuel"
      : (DAY_NAMES[ctx.dayKey] ?? ctx.dayKey)) +
    // Créneau « journée entière » (horaires vides) : libellé dédié au lieu de « – ».
    (createSlot
      ? ` · ${
          !createSlot.startTime || !createSlot.endTime
            ? "Journée entière"
            : `${createSlot.startTime}–${createSlot.endTime}`
        }`
      : "");

  return (
    <ModalOverlay onClose={onClose}>
      <button type="button" className="modal-close" onClick={onClose} aria-label="Fermer">
        ×
      </button>
      <div
        className="modal-title"
        style={{ display: "flex", alignItems: "center", gap: ".5rem", flexWrap: "wrap" }}
      >
        <span>➕ Nouvelle réservation :</span>
        {period && periodTag && (
          <span
            className="period-btn active"
            style={{
              cursor: "default",
              padding: ".12rem .5rem",
              fontSize: ".64rem",
              gap: ".3rem",
              textTransform: "capitalize",
            }}
          >
            <span className="period-badge" style={{ display: "block", background: period.color }} />
            {periodTag}
          </span>
        )}
        <span
          style={{
            fontSize: ".8rem",
            fontWeight: 500,
            color: "var(--muted)",
            textTransform: "capitalize",
          }}
        >
          {dayHour}
        </span>
      </div>
      <div className="form-grid">
        {serviceDemandeurs.length > 0 && (
          <div className="field full">
            <label htmlFor="pcm-demandeur-select">Type de demandeur</label>
            <select
              id="pcm-demandeur-select"
              value={cDemType}
              onChange={(e) => {
                setCDemType(e.target.value);
                setCStructure("");
                setCUser("");
              }}
            >
              <option value="">Tous les demandeurs</option>
              {serviceDemandeurs.map((d) => (
                <option key={d.id} value={d.label}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>
        )}
        {structureOptions.length > 0 && (
          <div className="field full">
            <label htmlFor="pcm-structure-select">Structure</label>
            <select
              id="pcm-structure-select"
              value={cStructure}
              onChange={(e) => {
                setCStructure(e.target.value);
                setCUser("");
              }}
            >
              <option value="">Toutes les structures</option>
              {structureOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="field full">
          <label htmlFor="pcm-user-select">Demandeur</label>
          <select id="pcm-user-select" value={cUser} onChange={(e) => setCUser(e.target.value)}>
            <option value="">— choisir —</option>
            {createUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field full">
          <span
            style={{
              fontSize: ".65rem",
              fontWeight: 600,
              letterSpacing: ".1em",
              textTransform: "uppercase",
              color: "var(--muted)",
            }}
          >
            Participants
          </span>
          <div className="pcm-counters">
            <label className="pcm-counter" htmlFor="pcm-enfants">
              <span className="pcm-counter-icon" aria-hidden="true">
                👶
              </span>
              <input
                id="pcm-enfants"
                type="number"
                min={0}
                max={99}
                value={cEnfants}
                onChange={(e) => setCEnfants(e.target.value)}
              />
              <span className="pcm-counter-name">{plural(nCEnf, "Enfant", "Enfants")}</span>
            </label>
            <label className="pcm-counter" htmlFor="pcm-accompagnants">
              <span className="pcm-counter-icon" aria-hidden="true">
                🧑‍🦰
              </span>
              <input
                id="pcm-accompagnants"
                type="number"
                min={0}
                max={99}
                value={cAccompagnants}
                onChange={(e) => setCAccompagnants(e.target.value)}
              />
              <span className="pcm-counter-name">{plural(nCAcc, "Adulte", "Adultes")}</span>
            </label>
          </div>
        </div>
        {themeMode && (
          <div className="field full">
            <label htmlFor="pcm-theme">
              Thème{" "}
              <span style={{ color: "var(--muted)", fontSize: ".7rem", fontWeight: 400 }}>
                (optionnel)
              </span>
            </label>
            {themesListMode ? (
              <select id="pcm-theme" value={cTheme} onChange={(e) => setCTheme(e.target.value)}>
                <option value="">— aucun —</option>
                {themes.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id="pcm-theme"
                value={cTheme}
                onChange={(e) => setCTheme(e.target.value)}
                placeholder="Thème de la visite…"
              />
            )}
          </div>
        )}
        {!ctx.ponctuel && createSlot && (
          <OccurrencesField
            // « Créneaux concernés » = occurrences qui seront EFFECTIVEMENT créées
            // (calcul chez le parent : miroirs ≥ aujourd'hui, semaine A/B effective,
            // vacances scolaires selon l'exercice ET le demandeur sélectionné).
            dates={occurrenceDatesFor(users.find((u) => u.id === cUser))}
            startTime={createSlot.startTime}
            endTime={createSlot.endTime}
          />
        )}
      </div>
      {cError && (
        <p className="field-error" style={{ display: "block" }}>
          {cError}
        </p>
      )}
      <div className="btn-row">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Annuler
        </button>
        <button type="button" className="btn btn-primary" onClick={submit}>
          Réserver
        </button>
      </div>
    </ModalOverlay>
  );
}
