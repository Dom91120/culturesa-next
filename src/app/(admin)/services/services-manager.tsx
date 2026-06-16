"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  type ServiceDeletionInfo,
  deleteServicesAction,
  getServiceDeletionInfoAction,
  saveServiceFromModalAction,
} from "./actions";
import { ICON_CATEGORIES, legacyServiceIcon } from "./legacy-icons";

type ServiceRow = { id: string; label: string; icon: string | null };

export function ServicesManager({
  services,
  embedded = false,
  onClose,
}: {
  services: ServiceRow[];
  // embedded : rendu en modale (référentiel Configuration) — pas de case à cocher, actions
  // (modifier/supprimer) par ligne, et bouton « Quitter » au lieu de la barre de sélection.
  embedded?: boolean;
  onClose?: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Sélection unique (comme l'ancien : cocher une ligne décoche les autres).
  const [selected, setSelected] = useState<string | null>(null);

  // Modale création / édition.
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [icon, setIcon] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Sélecteur d'icônes.
  const [iconPickerOpen, setIconPickerOpen] = useState(false);

  // Modale de confirmation de suppression (--danger) : service ciblé + décompte cascade.
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    info: ServiceDeletionInfo;
  } | null>(null);

  // Focus du champ nom à l'ouverture de la modale (comme l'ancienne version).
  const labelRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (modalOpen) labelRef.current?.focus();
  }, [modalOpen]);

  function toggleRow(id: string) {
    setSelected((cur) => (cur === id ? null : id));
  }

  function openCreate() {
    setEditingId(null);
    setLabel("");
    setIcon("");
    setError(null);
    setIconPickerOpen(false);
    setModalOpen(true);
  }

  function editSelected() {
    if (!selected) return;
    const s = services.find((x) => x.id === selected);
    if (!s) return;
    setEditingId(s.id);
    setLabel(s.label);
    setIcon(s.icon ?? "");
    setError(null);
    setIconPickerOpen(false);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setIconPickerOpen(false);
  }

  function submit() {
    const trimmed = label.trim();
    if (!trimmed) {
      setError("Le nom est obligatoire");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await saveServiceFromModalAction({
        id: editingId ?? undefined,
        label: trimmed,
        icon: icon || null,
      });
      if (res && !res.ok) {
        setError(res.error ?? "Erreur");
        return;
      }
      closeModal();
      setSelected(null);
      router.refresh();
    });
  }

  function deleteSelected() {
    if (!selected) return;
    if (!confirm("Supprimer 1 service(s) et toutes leurs réservations ?")) return;
    const id = selected;
    startTransition(async () => {
      await deleteServicesAction([id]);
      setSelected(null);
      router.refresh();
    });
  }

  // Actions par ligne (mode modale) : édition / suppression d'un service précis.
  function openEdit(s: ServiceRow) {
    setEditingId(s.id);
    setLabel(s.label);
    setIcon(s.icon ?? "");
    setError(null);
    setIconPickerOpen(false);
    setModalOpen(true);
  }
  // Clic sur 🗑️ d'une ligne : on charge le décompte cascade puis on ouvre la modale --danger.
  function deleteOne(id: string) {
    startTransition(async () => {
      const res = await getServiceDeletionInfoAction(id);
      if (res.ok) setDeleteTarget({ id, info: res.info });
    });
  }

  // Confirmation effective depuis la modale --danger.
  function confirmDelete() {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    startTransition(async () => {
      await deleteServicesAction([id]);
      setDeleteTarget(null);
      setSelected(null);
      router.refresh();
    });
  }

  return (
    <div>
      <div
        className="panel-title"
        style={{ justifyContent: "space-between", marginBottom: embedded ? "0.75rem" : undefined }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: ".6rem" }}>
          <span className="dot" style={{ background: "var(--warn)" }} />
          {embedded ? "Services" : "Configuration des services"}
        </span>
        {!embedded && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={openCreate}
            style={{ padding: ".3rem .75rem", fontSize: ".78rem" }}
          >
            ＋ Ajouter
          </button>
        )}
      </div>

      <div
        className="admin-table-wrap"
        style={embedded ? { borderBottom: "1px solid var(--border)" } : undefined}
      >
        <table className="admin-table" style={{ width: "100%" }}>
          <thead>
            <tr>
              {!embedded && <th className="col-check" style={{ width: "2rem" }} />}
              <th style={{ width: "2.5rem" }} />
              <th style={{ minWidth: 220 }}>Service</th>
              <th style={{ width: 90, textAlign: "center" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {services.map((s) => {
              const checked = selected === s.id;
              return (
                <tr key={s.id} className={checked ? "row-checked" : undefined}>
                  {!embedded && (
                    <td className="col-check">
                      <input type="checkbox" checked={checked} onChange={() => toggleRow(s.id)} />
                    </td>
                  )}
                  <td style={{ fontSize: "1.2rem", textAlign: "center" }}>
                    {legacyServiceIcon(s.label, s.id, s.icon)}
                  </td>
                  <td style={{ fontSize: ".9rem" }}>{s.label}</td>
                  <td style={{ textAlign: "center" }}>
                    {embedded ? (
                      <span style={{ display: "flex", gap: ".25rem", justifyContent: "center" }}>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => openEdit(s)}
                          title="Modifier"
                          style={{ fontSize: ".75rem", padding: ".15rem .4rem", lineHeight: 1 }}
                        >
                          ✏️
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => deleteOne(s.id)}
                          title="Supprimer"
                          style={{
                            fontSize: ".75rem",
                            padding: ".15rem .4rem",
                            lineHeight: 1,
                            color: "#e05555",
                            borderColor: "rgba(220,80,80,.4)",
                          }}
                        >
                          🗑️
                        </button>
                      </span>
                    ) : (
                      <Link
                        href={`/services/${s.id}`}
                        className="btn btn-ghost"
                        style={{
                          fontSize: ".72rem",
                          padding: ".2rem .5rem",
                          textDecoration: "none",
                        }}
                      >
                        Gérer
                      </Link>
                    )}
                  </td>
                </tr>
              );
            })}
            {services.length === 0 && (
              <tr>
                <td
                  colSpan={embedded ? 3 : 4}
                  style={{ textAlign: "center", padding: "1.5rem", color: "var(--muted)" }}
                >
                  Aucun service.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modale : actions par ligne ; sous le tableau, « ＋ Ajouter » à gauche de « ✕ Fermer ». */}
      {embedded && (
        <div
          style={{ display: "flex", justifyContent: "flex-end", gap: ".4rem", marginTop: ".75rem" }}
        >
          <button
            type="button"
            className="btn btn-ghost"
            onClick={openCreate}
            style={{ padding: ".16rem .45rem", fontSize: ".64rem" }}
          >
            ＋ Ajouter
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => onClose?.()}
            style={{ fontSize: ".64rem", padding: ".16rem .5rem" }}
          >
            ✕ Fermer
          </button>
        </div>
      )}

      {!embedded && (
        <div
          style={{
            marginTop: ".5rem",
            visibility: selected ? "visible" : "hidden",
            display: "flex",
            alignItems: "center",
            gap: ".75rem",
          }}
        >
          <span style={{ fontSize: ".82rem", color: "var(--muted)" }}>1 sélectionné</span>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={editSelected}
            style={{
              borderColor: "color-mix(in srgb, var(--accent) 40%, transparent)",
              color: "var(--accent)",
              fontSize: ".8rem",
            }}
          >
            ✏️ Modifier
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={deleteSelected}
            style={{ borderColor: "rgba(220,80,80,.4)", color: "#e05555", fontSize: ".8rem" }}
          >
            🗑️ Supprimer
          </button>
        </div>
      )}

      {modalOpen && (
        <div className="modal-overlay open" style={{ display: "flex" }}>
          <div className="modal-box" style={{ maxWidth: 660 }}>
            <div className="modal-title">
              {editingId ? "✏️ Modifier le service" : "➕ Nouveau service"}
            </div>
            <div className="form-grid" style={{ gap: "1rem 0" }}>
              <div className="field full">
                <label htmlFor="svc-modal-label">Nom du service</label>
                <div style={{ display: "flex", gap: ".5rem", alignItems: "center" }}>
                  <button
                    type="button"
                    onClick={() => setIconPickerOpen(true)}
                    title="Choisir une icône"
                    style={{
                      flexShrink: 0,
                      width: 38,
                      height: 38,
                      fontSize: "1.25rem",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--rad-sm)",
                      background: "var(--surface2)",
                      cursor: "pointer",
                    }}
                  >
                    {icon || "🎯"}
                  </button>
                  <input
                    ref={labelRef}
                    id="svc-modal-label"
                    type="text"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="Ex : Visite guidée"
                    autoComplete="off"
                    style={{ flex: 1 }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submit();
                    }}
                  />
                </div>
              </div>
            </div>
            {error && (
              <span className="field-error" style={{ display: "block", marginTop: ".5rem" }}>
                {error}
              </span>
            )}
            <div className="btn-row" style={{ marginTop: "1.25rem" }}>
              <button type="button" className="btn btn-ghost" onClick={closeModal}>
                Annuler
              </button>
              <button type="button" className="btn btn-primary" disabled={pending} onClick={submit}>
                {editingId ? "Enregistrer" : "Créer"}
              </button>
            </div>
            <button type="button" className="modal-close" onClick={closeModal}>
              ×
            </button>
          </div>
        </div>
      )}

      {iconPickerOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.5)",
            zIndex: 10010,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setIconPickerOpen(false);
          }}
        >
          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--rad-sm)",
              padding: "1.25rem 1.5rem",
              maxWidth: 480,
              width: "92%",
              maxHeight: "80vh",
              overflowY: "auto",
              boxShadow: "0 8px 32px rgba(0,0,0,.4)",
            }}
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
                onClick={() => setIconPickerOpen(false)}
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
                        setIcon(ic);
                        setIconPickerOpen(false);
                      }}
                      style={{
                        width: 36,
                        height: 36,
                        fontSize: "1.15rem",
                        border: `2px solid ${ic === icon ? "var(--accent)" : "transparent"}`,
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
          </div>
        </div>
      )}

      {/* Modale --danger : confirmation de suppression + décompte de la cascade. */}
      {deleteTarget && (
        <div
          className="modal-overlay open"
          style={{ display: "flex", zIndex: 10020 }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !pending) setDeleteTarget(null);
          }}
        >
          <div
            className="modal-box"
            style={{ maxWidth: 520, borderTop: "3px solid var(--danger)" }}
          >
            <div className="modal-title" style={{ color: "var(--danger)" }}>
              ⚠️ Supprimer le service
            </div>
            <p style={{ fontSize: ".85rem", lineHeight: 1.5, margin: "0 0 .75rem" }}>
              Le service <strong>« {deleteTarget.info.label} »</strong> et <strong>toutes</strong>{" "}
              ses données associées seront supprimés définitivement. Cette action est{" "}
              <strong>irréversible</strong>.
            </p>
            <div
              style={{
                background: "var(--danger-dim)",
                border: "1px solid var(--danger)",
                borderRadius: "var(--rad-sm)",
                padding: ".75rem .9rem",
                fontSize: ".8rem",
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: ".4rem" }}>
                Seront supprimés en cascade :
              </div>
              <ul
                style={{
                  margin: 0,
                  paddingLeft: "1.1rem",
                  display: "flex",
                  flexDirection: "column",
                  gap: ".15rem",
                }}
              >
                {(
                  [
                    ["réservation", "réservations", deleteTarget.info.counts.bookings],
                    ["créneau", "créneaux", deleteTarget.info.counts.slots],
                    ["période", "périodes", deleteTarget.info.counts.periods],
                    [
                      "affectation de gestionnaire",
                      "affectations de gestionnaire",
                      deleteTarget.info.counts.managers,
                    ],
                    ["thème", "thèmes", deleteTarget.info.counts.themes],
                    [
                      "réglage par demandeur",
                      "réglages par demandeur",
                      deleteTarget.info.counts.demandeurSettings,
                    ],
                  ] as [string, string, number][]
                ).map(([sing, plur, n]) => (
                  <li key={plur}>
                    <strong>{n}</strong> {n > 1 ? plur : sing}
                  </li>
                ))}
              </ul>
            </div>
            <div className="btn-row" style={{ marginTop: "1.25rem" }}>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={pending}
                onClick={() => setDeleteTarget(null)}
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={confirmDelete}
                style={{
                  background: "var(--danger)",
                  color: "#fff",
                  border: "1px solid var(--danger)",
                  borderRadius: "var(--rad-sm)",
                  padding: ".4rem .9rem",
                  fontSize: ".8rem",
                  cursor: pending ? "default" : "pointer",
                }}
              >
                {pending ? "Suppression…" : "Supprimer définitivement"}
              </button>
            </div>
            <button type="button" className="modal-close" onClick={() => setDeleteTarget(null)}>
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
