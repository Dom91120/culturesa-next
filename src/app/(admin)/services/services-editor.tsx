"use client";

import { useState } from "react";
import { ModalOverlay } from "@/components/agenda-shared";
import {
  RefColumnHeaders,
  RefDeleteConfirm,
  RefEditorFooter,
  RefEditorHeader,
  RefEmptyState,
  RefRow,
  RefStatePill,
  RF_GHOST,
} from "@/components/ref-editor-shell";
import { type RefActionResult, useBufferedRows } from "@/components/use-buffered-rows";
import type { ActionState } from "@/lib/action-state";
import { MailOffGlyph, PencilGlyph, TrashGlyph } from "../users/account-ui";
import { deleteServicesAction, saveServiceFromModalAction } from "./actions";
import { ICON_CATEGORIES } from "./legacy-icons";

type Initial = {
  id: string;
  label: string;
  icon: string | null;
  contactEmail: string | null;
  /** Comptes gestionnaire rattachés (reçoivent les e-mails du service à défaut de contact). */
  managers: number;
};
type Row = {
  id: string | null;
  label: string;
  icon: string | null;
  contactEmail: string;
  managers: number;
};

// Icône · Service · E-mail de contact · Gestionnaires · corbeille.
const GRID = "44px minmax(0, 1.1fr) minmax(0, 1fr) 128px 30px";

/** `ActionState` est nullable (contrat `useActionState`) ; `useBufferedRows` attend un résultat non-nul. */
function toRefResult(res: ActionState): RefActionResult {
  return res ?? { ok: true };
}

/**
 * Éditeur des services (modale du référentiel, Administration > Configuration) —
 * refonte Dom 2026-09-09. MODE TAMPON : modifications locales jusqu'au clic sur
 * « Enregistrer ». Icône (carré avec crayon → sélecteur), nom et e-mail de contact en
 * champs fantômes, colonne « Gestionnaires » qui dit qui reçoit les e-mails du service.
 */
export function ServicesEditor({ initial, onClose }: { initial: Initial[]; onClose?: () => void }) {
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  // Ligne dont le sélecteur d'icône est ouvert (null = fermé).
  const [pickerKey, setPickerKey] = useState<string | null>(null);

  const {
    rows,
    patch,
    addRow,
    removeRow,
    dirty,
    changes,
    rowState,
    error,
    saving,
    saveAll,
    cancelEdits,
  } = useBufferedRows<string, Initial, Row>({
    initial,
    fromInitial: (s) => ({
      id: s.id,
      label: s.label,
      icon: s.icon,
      contactEmail: s.contactEmail ?? "",
      managers: s.managers,
    }),
    isValid: (r) => r.label.trim() !== "",
    isDirty: (r, init) =>
      init.label !== r.label.trim() ||
      (init.icon ?? null) !== (r.icon ?? null) ||
      (init.contactEmail ?? "") !== r.contactEmail.trim(),
    onCreate: (r) =>
      saveServiceFromModalAction({
        label: r.label.trim(),
        icon: r.icon,
        contactEmail: r.contactEmail.trim() || null,
      }).then(toRefResult),
    onUpdate: (id, r) =>
      saveServiceFromModalAction({
        id,
        label: r.label.trim(),
        icon: r.icon,
        contactEmail: r.contactEmail.trim() || null,
      }).then(toRefResult),
    onDelete: (id) => deleteServicesAction([id]).then(toRefResult),
    onSyncReset: () => {
      setConfirmKey(null);
      setPickerKey(null);
    },
  });

  function add() {
    addRow({ id: null, label: "", icon: null, contactEmail: "", managers: 0 });
    setConfirmKey(null);
  }
  function remove(key: string) {
    setConfirmKey(null);
    removeRow(key);
  }

  const sansContact = rows.filter((r) => r.id !== null && !r.contactEmail.trim()).length;

  return (
    <div>
      <RefEditorHeader
        error={error}
        onAdd={add}
        addLabel="Ajouter un service"
        summary={
          sansContact > 0 ? (
            <span className="ms-pill is-warn">
              <MailOffGlyph size={11} /> {sansContact} sans e-mail de contact
            </span>
          ) : (
            <span className="ms-pill is-ok">tous ont un e-mail de contact</span>
          )
        }
      />

      <RefColumnHeaders gridTemplate={GRID}>
        <span style={{ textAlign: "center" }}>Icône</span>
        <span style={{ paddingLeft: ".5rem" }}>Service</span>
        <span style={{ paddingLeft: ".5rem" }}>E-mail de contact</span>
        <span style={{ textAlign: "right" }}>Gestionnaires</span>
        <span />
      </RefColumnHeaders>

      {rows.map((r) => {
        const confirming = confirmKey === r.key;
        const state = rowState(r);
        const hasContact = r.contactEmail.trim() !== "";
        return (
          <RefRow key={r.key} gridTemplate={GRID} state={state}>
            <button
              type="button"
              className={`rf-emoji${state === "new" ? " is-new" : ""}`}
              onClick={() => setPickerKey(r.key)}
              title="Choisir une icône"
              aria-label={`Choisir l'icône : ${r.label || "nouveau service"}`}
            >
              {r.icon || "🎯"}
              <span className="badge" aria-hidden="true">
                <PencilGlyph size={9} />
              </span>
            </button>

            {confirming ? (
              <RefDeleteConfirm
                gridColumn="2 / 6"
                message={
                  <>
                    Supprimer <strong>{r.label || "ce service"}</strong> et toutes ses données :
                    créneaux, périodes, réservations ? Irréversible.
                  </>
                }
                onConfirm={() => remove(r.key)}
                onCancel={() => setConfirmKey(null)}
              />
            ) : (
              <>
                <div className="rf-label">
                  <input
                    type="text"
                    className="rf-ghost"
                    value={r.label}
                    placeholder="Nom du service"
                    // Saisie gelée pendant l'enregistrement : le resync post-save
                    // (router.refresh) écraserait une frappe faite dans l'intervalle.
                    disabled={saving}
                    onChange={(e) => patch(r.key, { label: e.target.value })}
                    style={{ ...RF_GHOST, fontWeight: 600 }}
                  />
                </div>
                {/* E-mail générique de contact (facultatif) : proposé aux usagers pour
                    joindre le service (modale « plus de place disponible ») et destinataire
                    des e-mails « Le service » à la place des comptes gestionnaire. */}
                <input
                  type="email"
                  className="rf-ghost"
                  value={r.contactEmail}
                  placeholder="E-mail de contact"
                  disabled={saving}
                  onChange={(e) => patch(r.key, { contactEmail: e.target.value })}
                  style={{ ...RF_GHOST, fontSize: ".78rem" }}
                />
                <div className="rf-muted" style={{ textAlign: "right" }}>
                  {state ? (
                    <RefStatePill state={state} />
                  ) : hasContact ? (
                    `${r.managers} compte${r.managers > 1 ? "s" : ""}`
                  ) : r.managers > 0 ? (
                    <>
                      {`${r.managers} compte${r.managers > 1 ? "s" : ""}`}
                      <br />
                      {r.managers > 1 ? "reçoivent les e-mails" : "reçoit les e-mails"}
                    </>
                  ) : (
                    <span style={{ color: "var(--warn)" }}>
                      aucun compte
                      <br />
                      personne ne reçoit
                    </span>
                  )}
                </div>
                <div className="rf-act">
                  <button
                    type="button"
                    className="acct-action is-danger"
                    onClick={() => setConfirmKey(r.key)}
                    title="Supprimer ce service"
                    aria-label={`Supprimer le service : ${r.label}`}
                  >
                    <TrashGlyph size={14} />
                  </button>
                </div>
              </>
            )}
          </RefRow>
        );
      })}

      {rows.length === 0 && (
        <RefEmptyState>Aucun service. Cliquez sur « Ajouter un service ».</RefEmptyState>
      )}

      <RefEditorFooter
        dirty={dirty}
        changes={changes}
        saving={saving}
        onCancel={cancelEdits}
        onSave={saveAll}
        onClose={onClose}
      />

      {/* Sélecteur d'icône (cible la ligne `pickerKey`) : ModalOverlay partagé —
          fermeture au clic sur le fond ET à Échap (l'ancien overlay recodé à la main
          ignorait Échap, cf. audit 2026-07-17). */}
      {pickerKey !== null && (
        <ModalOverlay
          onClose={() => setPickerKey(null)}
          boxStyle={{ maxWidth: 480, width: "92%", maxHeight: "80vh", overflowY: "auto" }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "1rem",
            }}
          >
            <span style={{ fontSize: ".95rem", fontWeight: 600, color: "var(--text)" }}>
              Choisir une icône
            </span>
            <button
              type="button"
              onClick={() => setPickerKey(null)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: "1.2rem",
                color: "var(--muted)",
                lineHeight: 1,
              }}
            >
              ✕
            </button>
          </div>
          {ICON_CATEGORIES.map((cat) => (
            <div key={cat.label} style={{ marginBottom: ".85rem" }}>
              <div
                style={{
                  fontSize: ".62rem",
                  fontWeight: 700,
                  letterSpacing: ".1em",
                  textTransform: "uppercase",
                  color: "var(--muted)",
                  marginBottom: ".3rem",
                }}
              >
                {cat.label}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {cat.icons.map((ic) => (
                  <button
                    type="button"
                    key={ic}
                    onClick={() => {
                      patch(pickerKey, { icon: ic });
                      setPickerKey(null);
                    }}
                    style={{
                      width: 36,
                      height: 36,
                      fontSize: "1.15rem",
                      border: "2px solid transparent",
                      borderRadius: 6,
                      background: "var(--surface2)",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {ic}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </ModalOverlay>
      )}
    </div>
  );
}
