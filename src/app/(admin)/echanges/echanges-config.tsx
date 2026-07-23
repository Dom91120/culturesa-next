"use client";

import { useRouter } from "next/navigation";
import { memo, useCallback, useMemo, useState, useTransition } from "react";
import { ModalOverlay } from "@/components/agenda-shared";
import { GHOST_DANGER_STYLE } from "@/components/ui-styles";
import { emailButton, wrapEmailHtml } from "@/lib/email-theme";
import { renderHtmlTemplate } from "@/lib/mail-render";
import {
  createMailTypeAction,
  deleteMailTypeAction,
  setMailTemplateAction,
  updateMailTypeAction,
} from "./actions";
import { EmailFrame } from "./email-frame";
import { RichTextEditor } from "./rich-text-editor";

export type KindData = {
  kind: string;
  label: string;
  description: string;
  // Destinataire de l'e-mail (affiché en colonne quand `showRecipient`).
  recipient: string;
  // Verrouillé : e-mail système, toujours envoyé (case « Envoyer » cochée et non modifiable).
  locked: boolean;
  // E-mail système (compte/sécurité) : affiché dans la colonne « Système » (case cochée).
  system: boolean;
  // Type d'e-mail personnalisé (modifiable/supprimable). Absent/false → type intégré.
  deletable?: boolean;
  // Routé par au moins un service → suppression interdite (bouton désactivé).
  used?: boolean;
  subject: string;
  html: string;
  defaultSubject: string;
  defaultHtml: string;
  variables: { name: string; desc: string }[];
};

// Valeurs d'exemple pour l'aperçu (mêmes variables que le rendu serveur).
const SAMPLE: Record<string, string> = {
  salutation: "Bonjour Marie,",
  prenom: "Marie",
  usager: "Marie Martin",
  service: "Atelier poterie",
  creneau: "lundi 15 juin 2026 · 10:00 – 12:00",
  periode: "Vacances de printemps",
  participants: "2 enfants, 1 accompagnant",
  theme: "Découverte",
  motif: "Créneau déjà complet",
  url: "https://culturesa.exemple/lien",
  annees: "2 an(s)",
  delai: "30 jours",
  nombre: "3",
};
// Variables BRUTES (HTML non échappé) pour l'aperçu — miroir du serveur.
const SAMPLE_RAW: Record<string, string> = {
  bouton: emailButton("#", "Bouton d'action"),
  liste:
    '<ul style="padding-left:1.2em"><li style="margin:.2rem 0">Marie Martin — lundi 09:00 – 10:30 · Vacances de printemps</li><li style="margin:.2rem 0">Paul Durand — mardi 14:00 – 15:30</li></ul>',
};

export function EchangesConfig({
  rows,
  title = "Échanges par mails",
  intro,
  panelId = "echanges-panel",
  serviceId,
  showSystem = false,
  showRecipient = false,
  showSend = true,
  allowCreate = false,
  contentLabel = "Contenu",
}: {
  // Une ligne par TYPE d'e-mail (label + destinataire + contenu éditable). Utilisé pour
  // « Modèles d'e-mails » (par service) et « E-mails automatiques » (système, Messagerie).
  rows: KindData[];
  // Titre du panel + intro + id : permet de réutiliser cette table pour un autre groupe
  // d'e-mails (ex. panel « E-mails automatiques » de l'onglet Messagerie).
  title?: string;
  intro?: React.ReactNode;
  panelId?: string;
  // Fourni → gabarits/préférences réglés PAR SERVICE (e-mails de réservation) ; absent →
  // portée globale (e-mails système).
  serviceId?: string;
  // Affiche une colonne « Système » (case cochée/désactivée si e-mail système).
  showSystem?: boolean;
  // Affiche une colonne « Destinataire » (panel « E-mails automatiques »).
  showRecipient?: boolean;
  // Affiche la colonne « Envoyer » (masquée dans « Modèles d'e-mails » : l'envoi se règle
  // via la case « Envoyer » d'« Échanges par mail », par service).
  showSend?: boolean;
  // Autorise la création/suppression de types d'e-mails personnalisés (admin, « Modèles »).
  allowCreate?: boolean;
  // Libellé de l'en-tête de la colonne d'édition (« Contenu » par défaut, « Modèle » dans
  // « Modèles d'e-mails »).
  contentLabel?: string;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState<Record<string, { subject: string; html: string }>>(
    Object.fromEntries(rows.map((r) => [r.kind, { subject: r.subject, html: r.html }])),
  );
  const [draft, setDraft] = useState<Record<string, { subject: string; html: string }>>(
    Object.fromEntries(rows.map((r) => [r.kind, { subject: r.subject, html: r.html }])),
  );
  const [editing, setEditing] = useState<string | null>(null);

  // Resynchronise saved/draft quand le serveur renvoie de nouvelles `rows` (après un
  // router.refresh() : création / suppression / mise à jour d'un type d'e-mail). Sans ça,
  // un type fraîchement créé est absent de `draft` → `draft[kind]` undefined au rendu (et
  // `isDirty`/la modale plantent). Ajustement PENDANT le rendu (pattern React de sync
  // état↔prop) pour précéder la lecture de `draft` dans le JSX. Le brouillon de la ligne
  // en cours d'édition est préservé (saisie non encore enregistrée).
  const rowsSig = JSON.stringify(rows.map((r) => [r.kind, r.subject, r.html]));
  const [syncedSig, setSyncedSig] = useState(rowsSig);
  if (rowsSig !== syncedSig) {
    setSyncedSig(rowsSig);
    const fresh = Object.fromEntries(
      rows.map((r) => [r.kind, { subject: r.subject, html: r.html }]),
    );
    setSaved(fresh);
    setDraft((prev) => {
      const next: Record<string, { subject: string; html: string }> = { ...fresh };
      if (editing && prev[editing]) next[editing] = prev[editing];
      return next;
    });
  }

  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Incrémenté lors d'une réinitialisation pour forcer le remontage de l'éditeur WYSIWYG.
  const [editorNonce, setEditorNonce] = useState(0);
  // Création/suppression de types personnalisés (mode « Modèles d'e-mails », admin).
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  // Modale création/édition d'un type personnalisé : `kind === null` → création.
  const [metaEdit, setMetaEdit] = useState<{
    kind: string | null;
    label: string;
    description: string;
    recipient: string;
  } | null>(null);
  const isCreating = metaEdit?.kind === null;

  // Callbacks STABLES passés à <Row> (mémoïsé) : sans eux, toutes les lignes du tableau se
  // re-rendraient à chaque frappe dans la modale d'édition (closures recréées par rendu).
  const onEditKind = useCallback((kind: string) => setEditing(kind), []);
  const onAskDeleteKind = useCallback((kind: string) => setConfirmDelete(kind), []);
  const onEditMetaRow = useCallback(
    (row: KindData) =>
      setMetaEdit({
        kind: row.kind,
        label: row.label,
        description: row.description,
        recipient: row.recipient,
      }),
    [],
  );

  // Ouvre la modale en mode création (champs vierges + destinataire par défaut).
  function openCreate() {
    setMsg(null);
    // `recipient` conservé dans le type mais non éditable ici (réglé par service,
    // cf. « Échanges par mail ») — valeur neutre par défaut.
    setMetaEdit({ kind: null, label: "", description: "", recipient: "" });
  }

  function saveMeta() {
    if (!metaEdit) return;
    const m = metaEdit;
    // serviceId omis ⇒ portée globale (admin) ; l'action serveur applique le contrôle d'accès.
    setMsg(null);
    startTransition(async () => {
      const res =
        m.kind === null
          ? await createMailTypeAction(serviceId, m.label, m.description, m.recipient)
          : await updateMailTypeAction(serviceId, m.kind, m.label, m.description, m.recipient);
      if (res && !res.ok) {
        setMsg({ ok: false, text: res.error ?? "Échec de l'enregistrement." });
      } else {
        setMetaEdit(null);
        setMsg({
          ok: true,
          text: m.kind === null ? "Type d'e-mail créé ✓" : "Type d'e-mail mis à jour ✓",
        });
        router.refresh();
      }
    });
  }

  function deleteType(kind: string) {
    setConfirmDelete(null);
    setMsg(null);
    startTransition(async () => {
      const res = await deleteMailTypeAction(serviceId, kind);
      if (res && !res.ok) {
        setMsg({ ok: false, text: res.error ?? "Échec de la suppression." });
      } else {
        setMsg({ ok: true, text: "Type d'e-mail supprimé ✓" });
        router.refresh();
      }
    });
  }

  function setField(kind: string, field: "subject" | "html", value: string) {
    setDraft((d) => ({ ...d, [kind]: { ...d[kind], [field]: value } }));
  }

  function resetToDefault(r: KindData) {
    setDraft((d) => ({ ...d, [r.kind]: { subject: r.defaultSubject, html: r.defaultHtml } }));
    setEditorNonce((n) => n + 1); // remonte l'éditeur pour refléter le contenu par défaut
  }

  function saveTemplate(kind: string) {
    setMsg(null);
    const d = draft[kind];
    startTransition(async () => {
      const res = await setMailTemplateAction(kind, d.subject, d.html, serviceId);
      if (res && !res.ok) {
        setMsg({ ok: false, text: res.error ?? "Échec de l'enregistrement." });
      } else {
        setSaved((s) => ({ ...s, [kind]: { ...d } }));
        setMsg({ ok: true, text: "Modèle enregistré ✓" });
        setEditing(null); // ferme la modale après un enregistrement réussi
      }
    });
  }

  function isDirty(kind: string): boolean {
    return draft[kind].subject !== saved[kind].subject || draft[kind].html !== saved[kind].html;
  }

  // Modèle en cours d'édition (affiché dans la modale), ou null.
  const editingRow = editing ? (rows.find((r) => r.kind === editing) ?? null) : null;

  return (
    <div className="panel" id={panelId}>
      <div className="panel-title">
        <span style={{ display: "flex", alignItems: "center", gap: ".6rem" }}>
          <span className="dot" style={{ background: "var(--accent)" }} />
          {title}
        </span>
      </div>

      <p style={{ fontSize: ".85rem", lineHeight: 1.5, color: "var(--muted)", margin: "0 0 1rem" }}>
        {intro ?? "Personnalisez le contenu (objet + corps) de chaque e-mail via l'éditeur."}
      </p>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".85rem" }}>
        <thead>
          <tr>
            <th style={th("left")}>Type d&apos;e-mail</th>
            {showSystem && <th style={{ ...th("center"), width: 80 }}>Système</th>}
            {showRecipient && <th style={{ ...th("left"), width: 200 }}>Destinataire</th>}
            {showSend && <th style={{ ...th("center"), width: 90 }}>Envoyer</th>}
            <th style={{ ...th("center"), width: 140 }}>{contentLabel}</th>
            {allowCreate && <th style={{ ...th("center"), width: 180 }}>Action</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Row
              key={r.kind}
              r={r}
              showSystem={showSystem}
              showRecipient={showRecipient}
              showSend={showSend}
              showAction={allowCreate}
              // ✏️ (nom/description) : types perso, OU types intégrés en portée GLOBALE (admin).
              canEditMeta={allowCreate && (!!r.deletable || !serviceId)}
              // 🗑️ : types personnalisés uniquement.
              canDelete={allowCreate && !!r.deletable}
              onEdit={onEditKind}
              onEditMeta={onEditMetaRow}
              onAskDelete={onAskDeleteKind}
            />
          ))}
        </tbody>
      </table>

      {allowCreate && (
        <div style={{ marginTop: "1rem" }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={openCreate}
            disabled={pending}
            style={{ fontSize: ".78rem", whiteSpace: "nowrap" }}
          >
            ＋ Ajouter un type d&apos;e-mail
          </button>
        </div>
      )}

      {msg && (
        <span
          style={{
            display: "inline-block",
            marginTop: ".75rem",
            fontSize: ".8rem",
            color: msg.ok ? "var(--accent)" : "var(--danger)",
          }}
        >
          {msg.text}
        </span>
      )}

      {/* Modale d'édition d'un modèle d'e-mail (objet + corps + aperçu). */}
      {editingRow && (
        <ModalOverlay
          onClose={() => setEditing(null)}
          boxStyle={{ maxWidth: 980, width: "95vw", maxHeight: "95vh", overflowY: "auto" }}
        >
          <div className="modal-title">✏️ {editingRow.label}</div>
          <Editor
            draft={draft[editingRow.kind]}
            variables={editingRow.variables}
            label={editingRow.label}
            dirty={isDirty(editingRow.kind)}
            pending={pending}
            editorKey={`${editingRow.kind}-${editorNonce}`}
            onField={(f, v) => setField(editingRow.kind, f, v)}
            onReset={() => resetToDefault(editingRow)}
            onSave={() => saveTemplate(editingRow.kind)}
          />
          <button type="button" className="modal-close" onClick={() => setEditing(null)}>
            ×
          </button>
        </ModalOverlay>
      )}

      {/* Modale création / édition d'un type personnalisé (nom / description / destinataire). */}
      {metaEdit && (
        <ModalOverlay onClose={() => setMetaEdit(null)} boxStyle={{ maxWidth: 480, width: "95vw" }}>
          <div className="modal-title">
            {isCreating ? "Créer un type d'e-mail" : "Modifier le type d'e-mail"}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: ".7rem" }}>
            <label style={{ fontSize: ".78rem", fontWeight: 600 }}>
              Nom
              <input
                type="text"
                value={metaEdit.label}
                maxLength={100}
                onChange={(e) => setMetaEdit({ ...metaEdit, label: e.target.value })}
                style={{ width: "100%", boxSizing: "border-box", marginTop: ".2rem" }}
              />
            </label>
            <label style={{ fontSize: ".78rem", fontWeight: 600 }}>
              Description
              <input
                type="text"
                value={metaEdit.description}
                maxLength={300}
                onChange={(e) => setMetaEdit({ ...metaEdit, description: e.target.value })}
                style={{ width: "100%", boxSizing: "border-box", marginTop: ".2rem" }}
              />
            </label>
            {/* Le destinataire ne dépend plus du modèle mais de l'ACTION : il se règle
                  dans « Échanges par mail » (colonne Destinataire). */}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: ".5rem" }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setMetaEdit(null)}
                style={{ fontSize: ".78rem" }}
              >
                Annuler
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={saveMeta}
                disabled={pending || !metaEdit.label.trim()}
                style={{ fontSize: ".78rem" }}
              >
                {isCreating ? "＋ Créer" : "💾 Enregistrer"}
              </button>
            </div>
          </div>
          <button type="button" className="modal-close" onClick={() => setMetaEdit(null)}>
            ×
          </button>
        </ModalOverlay>
      )}

      {/* Modale de confirmation de suppression d'un type personnalisé (--danger). */}
      {confirmDelete && (
        <ModalOverlay
          onClose={() => setConfirmDelete(null)}
          boxStyle={{ maxWidth: 460, width: "95vw" }}
        >
          <div className="modal-title" style={{ color: "var(--danger)" }}>
            🗑️ Supprimer le type d&apos;e-mail
          </div>
          <p style={{ fontSize: ".85rem", lineHeight: 1.5, margin: "0 0 .4rem" }}>
            Vous êtes sur le point de supprimer le type{" "}
            <strong>« {rows.find((r) => r.kind === confirmDelete)?.label ?? ""} »</strong>.
          </p>
          <p
            style={{
              fontSize: ".78rem",
              color: "var(--danger)",
              fontWeight: 600,
              margin: "0 0 1rem",
            }}
          >
            ⚠️ Cette action est irréversible.
          </p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: ".5rem" }}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setConfirmDelete(null)}
              style={{ fontSize: ".78rem" }}
            >
              Annuler
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => deleteType(confirmDelete)}
              disabled={pending}
              style={{
                fontSize: ".78rem",
                background: "var(--danger)",
                border: "none",
                color: "var(--text)",
              }}
            >
              🗑️ Supprimer
            </button>
          </div>
          <button type="button" className="modal-close" onClick={() => setConfirmDelete(null)}>
            ×
          </button>
        </ModalOverlay>
      )}
    </div>
  );
}

function th(align: "left" | "center"): React.CSSProperties {
  return {
    textAlign: align,
    padding: ".5rem .6rem",
    borderBottom: "1px solid var(--border)",
    color: "var(--muted)",
    fontWeight: 600,
  };
}

// Mémoïsée : avec des callbacks parent STABLES, une ligne ne se re-rend que si SES données
// changent (et non à chaque frappe ailleurs dans le panneau).
const Row = memo(function Row({
  r,
  showSystem = false,
  showRecipient,
  showSend = true,
  showAction = false,
  canEditMeta = false,
  canDelete = false,
  onEdit,
  onEditMeta,
  onAskDelete,
}: {
  r: KindData;
  showSystem?: boolean;
  showRecipient: boolean;
  showSend?: boolean;
  // Affiche la colonne « Action » (admin, « Modèles d'e-mails »).
  showAction?: boolean;
  // Métadonnées (nom/description) éditables : types perso, ou types intégrés au niveau global.
  canEditMeta?: boolean;
  // Supprimable : types personnalisés uniquement.
  canDelete?: boolean;
  onEdit: (kind: string) => void;
  onEditMeta?: (r: KindData) => void;
  // Demande la suppression : ouvre la modale de confirmation (--danger) au niveau du parent.
  onAskDelete?: (kind: string) => void;
}) {
  const cell: React.CSSProperties = {
    padding: ".55rem .6rem",
    borderBottom: "1px solid var(--border)",
  };
  return (
    <tr>
      <td style={cell}>
        <div style={{ fontWeight: 600 }}>{r.label}</div>
        {r.description && (
          <div style={{ fontSize: ".76rem", color: "var(--muted)", marginTop: ".15rem" }}>
            {r.description}
          </div>
        )}
      </td>
      {showSystem && (
        <td style={{ ...cell, textAlign: "center" }}>
          <input
            type="checkbox"
            aria-label={`Système : ${r.label}`}
            checked={r.system}
            disabled
            readOnly
            title={r.system ? "E-mail système" : "E-mail de réservation (non système)"}
            style={{ width: 16, height: 16, cursor: "default" }}
          />
        </td>
      )}
      {showRecipient && (
        <td style={{ ...cell, fontSize: ".82rem" }}>
          {/* Destinataire intrinsèque (e-mails système) ; pour les e-mails de réservation il se
              règle GLOBALEMENT dans « Échanges par mail » (colonne Destinataire). */}
          {r.locked ? (
            r.recipient
          ) : (
            <span
              style={{ color: "var(--muted)" }}
              title="Défini dans « Échanges par mail » (colonne Destinataire), commun à tous les services."
            >
              Voir « Échanges par mail »
            </span>
          )}
        </td>
      )}
      {showSend && (
        <td style={{ ...cell, textAlign: "center" }}>
          {/* E-mails système : toujours envoyés (affichage en lecture seule). */}
          <input
            type="checkbox"
            aria-label={`Envoyer : ${r.label}`}
            checked
            disabled
            readOnly
            title="Cet e-mail est toujours envoyé (non désactivable)."
            style={{ width: 18, height: 18, cursor: "default" }}
          />
        </td>
      )}
      <td style={{ ...cell, textAlign: "center" }}>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => onEdit(r.kind)}
          style={{ padding: ".25rem .6rem", fontSize: ".76rem" }}
        >
          ✏️ Modifier
        </button>
      </td>
      {showAction && (
        <td style={{ ...cell, textAlign: "center" }}>
          {!canEditMeta && !canDelete ? (
            <span style={{ color: "var(--muted)" }}>—</span>
          ) : (
            <span style={{ display: "inline-flex", alignItems: "center", gap: ".35rem" }}>
              {canEditMeta && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => onEditMeta?.(r)}
                  title="Modifier le nom et la description"
                  aria-label={`Modifier le type : ${r.label}`}
                  style={{ padding: ".25rem .5rem", fontSize: ".76rem" }}
                >
                  ✏️
                </button>
              )}
              {canDelete && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => onAskDelete?.(r.kind)}
                  disabled={r.used}
                  title={
                    r.used
                      ? "Type utilisé par au moins un service : retirez-le des actions avant de le supprimer."
                      : "Supprimer ce type d'e-mail"
                  }
                  aria-label={`Supprimer le type : ${r.label}`}
                  style={{
                    padding: ".25rem .45rem",
                    fontSize: ".76rem",
                    ...(r.used
                      ? { color: "var(--muted)", borderColor: "var(--border)" }
                      : GHOST_DANGER_STYLE),
                    cursor: r.used ? "not-allowed" : "pointer",
                  }}
                >
                  🗑️
                </button>
              )}
            </span>
          )}
        </td>
      )}
    </tr>
  );
});

function Editor({
  draft,
  variables,
  label,
  dirty,
  pending,
  editorKey,
  onField,
  onReset,
  onSave,
}: {
  draft: { subject: string; html: string };
  variables: { name: string; desc: string }[];
  label: string;
  dirty: boolean;
  pending: boolean;
  editorKey: string;
  onField: (field: "subject" | "html", value: string) => void;
  onReset: () => void;
  onSave: () => void;
}) {
  // Bascule : édition directe dans l'e-mail habillé (défaut) ↔ aperçu avec les données
  // d'exemple (lecture seule, iframe = rendu de référence, identique à l'envoi).
  const [showPreview, setShowPreview] = useState(false);
  const previewHtml = useMemo(
    () => renderHtmlTemplate(draft.html, SAMPLE, SAMPLE_RAW),
    [draft.html],
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: ".6rem" }}>
      {/* Libellé à GAUCHE du champ, même style que le titre « Corps » (les styles globaux
          de <label> — majuscules, espacement, gris — sont neutralisés), champ réduit d'autant. */}
      <div style={{ display: "flex", alignItems: "center", gap: ".6rem" }}>
        <label
          htmlFor="tpl-subject"
          style={{
            fontSize: ".76rem",
            fontWeight: 600,
            whiteSpace: "nowrap",
            textTransform: "none",
            letterSpacing: "normal",
            color: "var(--text)",
          }}
        >
          Objet
        </label>
        <input
          id="tpl-subject"
          type="text"
          value={draft.subject}
          maxLength={500}
          onChange={(e) => onField("subject", e.target.value)}
          style={{ flex: 1, boxSizing: "border-box" }}
        />
      </div>

      <div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: ".5rem",
            marginBottom: ".3rem",
          }}
        >
          <div style={{ fontSize: ".76rem", fontWeight: 600 }}>
            {showPreview
              ? "Aperçu (données d'exemple)"
              : "Corps — édition directe dans l'e-mail (en-tête et pied non modifiables)"}
          </div>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setShowPreview((v) => !v)}
            style={{ padding: ".2rem .6rem", fontSize: ".74rem" }}
          >
            {showPreview ? "✏️ Reprendre l'édition" : "👁️ Aperçu avec données d'exemple"}
          </button>
        </div>

        {/* Éditeur habillé — MASQUÉ (pas démonté) en mode aperçu : l'historique
            d'annulation et la position du curseur sont préservés. */}
        <div style={{ display: showPreview ? "none" : undefined }}>
          <RichTextEditor
            key={editorKey}
            initialHtml={draft.html}
            variables={variables}
            ariaLabel={`Corps de l'e-mail : ${label}`}
            onChange={(html) => onField("html", html)}
            renderFrame={(content) => <EmailFrame>{content}</EmailFrame>}
            actions={
              <span style={{ display: "inline-flex", gap: ".5rem" }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={onReset}
                  disabled={pending}
                  style={{ fontSize: ".72rem", padding: ".25rem .55rem" }}
                >
                  ↺ Réinitialiser
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={onSave}
                  disabled={pending || !dirty}
                  style={{ fontSize: ".72rem", padding: ".25rem .55rem" }}
                >
                  💾 Enregistrer
                </button>
              </span>
            }
          />
          <div style={{ fontSize: ".7rem", color: "var(--muted)", marginTop: ".3rem" }}>
            Astuce : un bloc <code>{"{{#if periode}}…{{/if}}"}</code> n&apos;apparaît que si la
            variable est renseignée.
          </div>
        </div>

        {showPreview && (
          <iframe
            title="Aperçu de l'e-mail"
            // sandbox sans allow-scripts : l'aperçu rend du HTML d'éditeur (Tiptap) mais
            // n'exécute aucun script éventuellement collé dans le contenu.
            sandbox=""
            srcDoc={wrapEmailHtml(previewHtml, { preheader: "", logoSrc: "/email-logo.png" })}
            style={{
              width: "100%",
              minHeight: 460,
              border: "1px solid var(--border)",
              borderRadius: 6,
              background: "#fff",
            }}
          />
        )}
      </div>
    </div>
  );
}
