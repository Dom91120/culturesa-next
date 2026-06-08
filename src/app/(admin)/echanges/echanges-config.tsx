"use client";

import { emailButton, wrapEmailHtml } from "@/lib/email-theme";
import { useState, useTransition } from "react";
import { setMailPrefAction, setMailTemplateAction } from "./actions";
import { RichTextEditor } from "./rich-text-editor";

export type KindData = {
  kind: string;
  label: string;
  description: string;
  enabled: boolean;
  // Verrouillé : e-mail toujours envoyé (case « Envoyer » cochée et non modifiable).
  locked: boolean;
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
  service: "Atelier poterie",
  creneau: "lundi 15 juin 2026 · 10:00 – 12:00",
  periode: "Vacances de printemps",
  participants: "2 enfants, 1 accompagnant",
  theme: "Découverte",
  motif: "Créneau déjà complet",
  url: "https://culturesa.exemple/lien",
  annees: "2 an(s)",
  delai: "30 jours",
};
// Variables BRUTES (HTML non échappé) pour l'aperçu — miroir du serveur.
const SAMPLE_RAW: Record<string, string> = {
  bouton: emailButton("#", "Bouton d'action"),
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Rendu d'aperçu : miroir du moteur serveur (conditionnels + variables échappées + brutes).
function renderPreview(
  html: string,
  vars: Record<string, string>,
  rawVars: Record<string, string>,
): string {
  const all = { ...vars, ...rawVars };
  return html
    .replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_m, k, inner) =>
      (all[k] ?? "").trim() ? inner : "",
    )
    .replace(/\{\{(\w+)\}\}/g, (_m, k) =>
      k in rawVars ? rawVars[k] : esc(vars[k] ?? "").replace(/\n/g, "<br>"),
    );
}

export function EchangesConfig({ rows }: { rows: KindData[] }) {
  const [enabled, setEnabled] = useState<Record<string, boolean>>(
    Object.fromEntries(rows.map((r) => [r.kind, r.enabled])),
  );
  const [saved, setSaved] = useState<Record<string, { subject: string; html: string }>>(
    Object.fromEntries(rows.map((r) => [r.kind, { subject: r.subject, html: r.html }])),
  );
  const [draft, setDraft] = useState<Record<string, { subject: string; html: string }>>(
    Object.fromEntries(rows.map((r) => [r.kind, { subject: r.subject, html: r.html }])),
  );
  const [editing, setEditing] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Incrémenté lors d'une réinitialisation pour forcer le remontage de l'éditeur WYSIWYG.
  const [editorNonce, setEditorNonce] = useState(0);

  function toggleSend(kind: string, value: boolean) {
    setMsg(null);
    setEnabled((s) => ({ ...s, [kind]: value }));
    startTransition(async () => {
      const res = await setMailPrefAction(kind, value);
      if (res && !res.ok) {
        setEnabled((s) => ({ ...s, [kind]: !value }));
        setMsg({ ok: false, text: res.error ?? "Échec de l'enregistrement." });
      } else {
        setMsg({ ok: true, text: "Préférence enregistrée ✓" });
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
      const res = await setMailTemplateAction(kind, d.subject, d.html);
      if (res && !res.ok) {
        setMsg({ ok: false, text: res.error ?? "Échec de l'enregistrement." });
      } else {
        setSaved((s) => ({ ...s, [kind]: { ...d } }));
        setMsg({ ok: true, text: "Modèle enregistré ✓" });
      }
    });
  }

  function isDirty(kind: string): boolean {
    return draft[kind].subject !== saved[kind].subject || draft[kind].html !== saved[kind].html;
  }

  return (
    <div className="panel" id="echanges-panel">
      <div className="panel-title">
        <span style={{ display: "flex", alignItems: "center", gap: ".6rem" }}>
          <span className="dot" style={{ background: "var(--accent)" }} />
          Échanges — e-mails automatiques
        </span>
      </div>

      <p style={{ fontSize: ".85rem", lineHeight: 1.5, color: "var(--muted)", margin: "0 0 1rem" }}>
        Personnalisez le contenu (objet + corps) de chaque e-mail automatique via l&apos;éditeur, et
        choisissez ceux que l&apos;application envoie. Décocher « Envoyer » désactive l&apos;envoi
        de ce type d&apos;e-mail (les réservations continuent de fonctionner). Les e-mails de{" "}
        <strong>compte&nbsp;/&nbsp;sécurité</strong> (confirmation d&apos;adresse, mot de passe,
        préavis RGPD) sont <strong>toujours envoyés</strong> : leur case est verrouillée, mais leur
        contenu reste modifiable.
      </p>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".85rem" }}>
        <thead>
          <tr>
            <th style={th("left")}>Type d&apos;e-mail</th>
            <th style={{ ...th("center"), width: 90 }}>Envoyer</th>
            <th style={{ ...th("center"), width: 140 }}>Contenu</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const open = editing === r.kind;
            return (
              <Row
                key={r.kind}
                r={r}
                open={open}
                enabled={enabled[r.kind] ?? true}
                draft={draft[r.kind]}
                dirty={isDirty(r.kind)}
                pending={pending}
                editorKey={`${r.kind}-${editorNonce}`}
                onToggleSend={(v) => toggleSend(r.kind, v)}
                onToggleEdit={() => setEditing(open ? null : r.kind)}
                onField={(f, v) => setField(r.kind, f, v)}
                onReset={() => resetToDefault(r)}
                onSave={() => saveTemplate(r.kind)}
              />
            );
          })}
        </tbody>
      </table>

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

function Row({
  r,
  open,
  enabled,
  draft,
  dirty,
  pending,
  editorKey,
  onToggleSend,
  onToggleEdit,
  onField,
  onReset,
  onSave,
}: {
  r: KindData;
  open: boolean;
  enabled: boolean;
  draft: { subject: string; html: string };
  dirty: boolean;
  pending: boolean;
  editorKey: string;
  onToggleSend: (v: boolean) => void;
  onToggleEdit: () => void;
  onField: (field: "subject" | "html", value: string) => void;
  onReset: () => void;
  onSave: () => void;
}) {
  const cell: React.CSSProperties = {
    padding: ".55rem .6rem",
    borderBottom: "1px solid var(--border)",
  };
  return (
    <>
      <tr>
        <td style={cell}>
          <div style={{ fontWeight: 600 }}>{r.label}</div>
          <div style={{ fontSize: ".76rem", color: "var(--muted)", marginTop: ".15rem" }}>
            {r.description}
          </div>
        </td>
        <td style={{ ...cell, textAlign: "center" }}>
          <input
            type="checkbox"
            aria-label={`Envoyer : ${r.label}`}
            // Verrouillé → toujours coché et non modifiable (e-mail obligatoire).
            checked={r.locked ? true : enabled}
            disabled={pending || r.locked}
            title={r.locked ? "Cet e-mail est toujours envoyé (non désactivable)." : undefined}
            onChange={(e) => onToggleSend(e.target.checked)}
            style={{
              width: 18,
              height: 18,
              cursor: pending || r.locked ? "default" : "pointer",
            }}
          />
        </td>
        <td style={{ ...cell, textAlign: "center" }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onToggleEdit}
            style={{ padding: ".25rem .6rem", fontSize: ".76rem" }}
          >
            {open ? "Fermer" : "✏️ Modifier"}
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={3} style={{ padding: ".6rem", borderBottom: "1px solid var(--border)" }}>
            <Editor
              draft={draft}
              variables={r.variables}
              label={r.label}
              dirty={dirty}
              pending={pending}
              editorKey={editorKey}
              onField={onField}
              onReset={onReset}
              onSave={onSave}
            />
          </td>
        </tr>
      )}
    </>
  );
}

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
  const previewHtml = renderPreview(draft.html, SAMPLE, SAMPLE_RAW);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: ".6rem" }}>
      <div className="field" style={{ margin: 0 }}>
        <label htmlFor="tpl-subject" style={{ fontSize: ".76rem", fontWeight: 600 }}>
          Objet
        </label>
        <input
          id="tpl-subject"
          type="text"
          value={draft.subject}
          maxLength={500}
          onChange={(e) => onField("subject", e.target.value)}
          style={{ width: "100%", boxSizing: "border-box" }}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: ".6rem" }}>
        <div>
          <div style={{ fontSize: ".76rem", fontWeight: 600, marginBottom: ".3rem" }}>Corps</div>
          <RichTextEditor
            key={editorKey}
            initialHtml={draft.html}
            variables={variables}
            ariaLabel={`Corps de l'e-mail : ${label}`}
            onChange={(html) => onField("html", html)}
          />
          <div style={{ fontSize: ".7rem", color: "var(--muted)", marginTop: ".3rem" }}>
            Astuce : un bloc <code>{"{{#if periode}}…{{/if}}"}</code> n&apos;apparaît que si la
            variable est renseignée.
          </div>
        </div>
        <div>
          <div style={{ fontSize: ".76rem", fontWeight: 600, marginBottom: ".3rem" }}>
            Aperçu (e-mail habillé, données d&apos;exemple)
          </div>
          <iframe
            title="Aperçu de l'e-mail"
            srcDoc={wrapEmailHtml(previewHtml, { preheader: "", logoSrc: "/email-logo.png" })}
            style={{
              width: "100%",
              minHeight: 360,
              border: "1px solid var(--border)",
              borderRadius: 6,
              background: "#fff",
            }}
          />
        </div>
      </div>

      <div style={{ display: "flex", gap: ".5rem", justifyContent: "flex-end" }}>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={onReset}
          disabled={pending}
          style={{ fontSize: ".78rem" }}
        >
          ↺ Réinitialiser
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={onSave}
          disabled={pending || !dirty}
          style={{ fontSize: ".78rem" }}
        >
          💾 Enregistrer
        </button>
      </div>
    </div>
  );
}
