"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { memo, useCallback, useMemo, useState, useTransition } from "react";
import { ModalOverlay } from "@/components/agenda-shared";
import {
  CalendarTimeGlyph,
  CircleCheckGlyph,
  FileCodeGlyph,
  InfoGlyph,
  ListDetailsGlyph,
  MailForwardGlyph,
  ShieldLockGlyph,
} from "@/components/ui-glyphs";
import { emailButton, wrapEmailHtml } from "@/lib/email-theme";
import { renderHtmlTemplate } from "@/lib/mail-render";
import { MailOffGlyph, PencilGlyph, SendGlyph, TrashGlyph, UsersGlyph } from "../users/account-ui";
import {
  createMailTypeAction,
  deleteMailTypeAction,
  setMailTemplateAction,
  updateMailTypeAction,
} from "./actions";
import { EmailFrame } from "./email-frame";
import type { KindFamily, KindUsage } from "./mail-rows";

// ════════════════════════════════════════════════════════════════════════════
//  « Modèles d'e-mails » — refonte Dom 2026-09-09 : familles (Compte et sécurité /
//  Gestionnaires / Réservations / Personnalisés) avec leur règle en intertitre, filtres
//  par famille avec effectifs + filtre « Modifiés » + recherche, pastille d'état du
//  texte (par défaut / modifié), usage par les actions de « Échanges par mail »,
//  actions au survol. Les modales (éditeur, nom/description, suppression) sont
//  inchangées. Sert aussi aux Paramètres › Échanges de chaque service (types de
//  réservation seuls, sans création).
// ════════════════════════════════════════════════════════════════════════════

// Éditeur TipTap chargé À LA DEMANDE (audit 2026-07-24) : l'import statique
// embarquait TipTap/ProseMirror (~33 paquets) dans le chunk des pages Échanges,
// payé à CHAQUE ouverture de l'onglet alors que l'éditeur n'est rendu que dans la
// modale d'édition. `ssr:false` : composant purement interactif, inutile en SSR.
// Le remontage par editorNonce (prop `key`) est indépendant du chargement différé.
const RichTextEditor = dynamic(() => import("./rich-text-editor").then((m) => m.RichTextEditor), {
  ssr: false,
  loading: () => <div className="muted">Chargement de l’éditeur…</div>,
});

export type KindData = {
  kind: string;
  label: string;
  description: string;
  // Destinataire intrinsèque (e-mails système) ; pour les e-mails de réservation il se règle
  // par action dans « Échanges par mail ».
  recipient: string;
  // Famille (intertitre, pictogramme, filtre).
  family: KindFamily;
  // Actions de « Échanges par mail » routées vers ce type (réservation / perso), sinon null.
  usage: KindUsage | null;
  // Texte différent de sa référence (défaut livré, ou base globale en portée service).
  modified: boolean;
  // Verrouillé : e-mail système, toujours envoyé.
  locked: boolean;
  // E-mail système (compte/sécurité).
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

const FAMILY_ORDER: KindFamily[] = [
  "compte",
  "gestionnaires",
  "reservations",
  "absences",
  "attente",
  "perso",
];
const FAMILY_LABEL: Record<KindFamily, string> = {
  compte: "Compte et sécurité",
  gestionnaires: "Gestionnaires",
  reservations: "Réservations",
  absences: "Absences prévenues",
  attente: "Liste d'attente",
  perso: "Personnalisés",
};
const FAMILY_HINT: Record<KindFamily, string> = {
  compte: "toujours envoyés",
  gestionnaires: "récapitulatifs, fréquence réglée par service",
  reservations: "base commune, surchargeable dans chaque service",
  absences: "signalement à l'avance, surchargeable dans chaque service",
  attente: "inscription, créneaux libérés, inscription automatique, échéance",
  perso: "créés ici, routables partout",
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
  title = "Modèles d'e-mails",
  intro,
  panelId = "echanges-panel",
  serviceId,
  allowCreate = false,
}: {
  // Une ligne par TYPE d'e-mail (label + destinataire + contenu éditable).
  rows: KindData[];
  title?: string;
  // Explication affichée en pied de panneau.
  intro?: React.ReactNode;
  panelId?: string;
  // Fourni → gabarits réglés PAR SERVICE (e-mails de réservation) ; absent → portée globale.
  serviceId?: string;
  // Autorise la création/suppression de types d'e-mails personnalisés (admin, « Modèles »).
  allowCreate?: boolean;
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
  // Mémoïsée sur la référence `rows` : sans ça, la sérialisation (HTML complets,
  // dizaines de Ko) était recalculée à CHAQUE rendu — donc à chaque frappe dans
  // l'éditeur TipTap (audit 2026-07-24). `rows` ne change de référence qu'au
  // re-rendu serveur (router.refresh), exactement ce que la signature détecte.
  const rowsSig = useMemo(
    () => JSON.stringify(rows.map((r) => [r.kind, r.subject, r.html])),
    [rows],
  );
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

  // Filtres : famille, « Modifiés », recherche libre.
  const [family, setFamily] = useState<KindFamily | "all">("all");
  const [onlyModified, setOnlyModified] = useState(false);
  const [query, setQuery] = useState("");

  const counts = useMemo(() => {
    const c: Record<KindFamily, number> = {
      compte: 0,
      gestionnaires: 0,
      reservations: 0,
      absences: 0,
      attente: 0,
      perso: 0,
    };
    for (const r of rows) c[r.family]++;
    return c;
  }, [rows]);
  const modifiedCount = useMemo(() => rows.filter((r) => r.modified).length, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (family !== "all" && r.family !== family) return false;
      if (onlyModified && !r.modified) return false;
      if (!q) return true;
      return [r.label, r.description, r.subject, r.recipient].join(" ").toLowerCase().includes(q);
    });
  }, [rows, family, onlyModified, query]);

  // Callbacks STABLES passés à <Row> (mémoïsé) : sans eux, toutes les lignes se
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
    // `recipient` conservé dans le type mais non éditable ici (réglé par action,
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
          text: m.kind === null ? "Type d'e-mail créé" : "Type d'e-mail mis à jour",
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
        setMsg({ ok: true, text: "Type d'e-mail supprimé" });
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
        setMsg({ ok: true, text: "Modèle enregistré" });
        setEditing(null); // ferme la modale après un enregistrement réussi
        // La pastille « modifié » et le filtre viennent du serveur : on le resollicite.
        router.refresh();
      }
    });
  }

  function isDirty(kind: string): boolean {
    return draft[kind].subject !== saved[kind].subject || draft[kind].html !== saved[kind].html;
  }

  // Modèle en cours d'édition (affiché dans la modale), ou null.
  const editingRow = editing ? (rows.find((r) => r.kind === editing) ?? null) : null;

  const headBtn = {
    padding: ".25rem .65rem",
    fontSize: ".68rem",
    display: "inline-flex",
    alignItems: "center",
    gap: ".35rem",
  } as const;

  return (
    <div className="panel" id={panelId}>
      <div
        className="panel-title"
        style={{ justifyContent: "space-between", gap: ".75rem", marginBottom: ".5rem" }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: ".6rem" }}>
          <span className="rg-ico is-ok">
            <FileCodeGlyph size={16} />
          </span>
          {title}
          <span style={{ color: "var(--muted)", fontWeight: 400 }}>· {rows.length}</span>
        </span>
        {allowCreate && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={openCreate}
            disabled={pending}
            style={headBtn}
          >
            ＋ Ajouter un type
          </button>
        )}
      </div>

      <div className="acct-toolbar" style={{ marginBottom: ".2rem" }}>
        <button
          type="button"
          className={`acct-chip${family === "all" ? " is-on" : ""}`}
          aria-pressed={family === "all"}
          onClick={() => setFamily("all")}
        >
          Tout<span className="n">{rows.length}</span>
        </button>
        {FAMILY_ORDER.filter((f) => counts[f] > 0).map((f) => (
          <button
            key={f}
            type="button"
            className={`acct-chip${family === f ? " is-on" : ""}`}
            aria-pressed={family === f}
            onClick={() => setFamily(f)}
          >
            {FAMILY_LABEL[f]}
            <span className="n">{counts[f]}</span>
          </button>
        ))}
        <button
          type="button"
          className={`acct-chip ex-chip-mod${onlyModified ? " is-on" : ""}`}
          aria-pressed={onlyModified}
          title="Ne montrer que les textes retouchés"
          onClick={() => setOnlyModified((v) => !v)}
        >
          <PencilGlyph size={11} /> Modifiés<span className="n">{modifiedCount}</span>
        </button>
        <div className="acct-toolbar-right">
          <div className="search-wrap">
            {/* biome-ignore lint/a11y/noSvgWithoutTitle: icône décorative (même loupe que les autres listes) */}
            <svg
              className="search-icon"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
              />
            </svg>
            <input
              type="search"
              aria-label="Rechercher un modèle"
              placeholder="Nom, description, objet…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p style={{ fontSize: ".8rem", color: "var(--muted)", margin: ".8rem 0 0" }}>
          Aucun modèle ne correspond à ce filtre.
        </p>
      ) : (
        FAMILY_ORDER.map((fam) => {
          const items = filtered.filter((r) => r.family === fam);
          if (items.length === 0) return null;
          return (
            <div key={fam}>
              <div className="ms-grp">
                {FAMILY_LABEL[fam]}
                <span className="hint">· {FAMILY_HINT[fam]}</span>
              </div>
              {items.map((r) => (
                <Row
                  key={r.kind}
                  r={r}
                  // Nom/description : types perso, OU types intégrés en portée GLOBALE (admin).
                  canEditMeta={allowCreate && (!!r.deletable || !serviceId)}
                  // Corbeille : types personnalisés uniquement.
                  canDelete={allowCreate && !!r.deletable}
                  onEdit={onEditKind}
                  onEditMeta={onEditMetaRow}
                  onAskDelete={onAskDeleteKind}
                />
              ))}
            </div>
          );
        })
      )}

      <div className="rg-foot">
        <InfoGlyph size={13} />
        <span style={{ flex: 1, lineHeight: 1.45 }}>
          {intro ?? "Personnalisez le contenu (objet et corps) de chaque e-mail via l'éditeur."}
        </span>
        {msg && (
          <span
            role="status"
            style={{
              color: msg.ok ? "var(--accent)" : "var(--danger)",
              display: "inline-flex",
              alignItems: "center",
              gap: ".3rem",
            }}
          >
            {msg.ok ? <CircleCheckGlyph size={13} /> : <MailOffGlyph size={13} />}
            {msg.text}
          </span>
        )}
      </div>

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

/** Pictogramme teinté par famille (bouclier, gestionnaires, calendrier, personnalisé). */
function FamilyIcon({ r }: { r: KindData }) {
  if (r.kind === "email_test") {
    return (
      <span className="rg-ico is-neutral">
        <SendGlyph size={14} />
      </span>
    );
  }
  switch (r.family) {
    case "compte":
      return (
        <span className="rg-ico is-neutral">
          <ShieldLockGlyph size={14} />
        </span>
      );
    case "gestionnaires":
      return (
        <span className="rg-ico is-warn">
          <UsersGlyph size={14} />
        </span>
      );
    case "reservations":
      return (
        <span className="rg-ico is-ok">
          <CalendarTimeGlyph size={14} />
        </span>
      );
    // Absence prévenue : orange, comme le macaron « A » des badges de l'agenda.
    case "absences":
      return (
        <span className="rg-ico is-warn">
          <CalendarTimeGlyph size={14} />
        </span>
      );
    case "attente":
      return (
        <span className="rg-ico is-purple">
          <ListDetailsGlyph size={14} />
        </span>
      );
    default:
      return (
        <span className="rg-ico is-info">
          <PencilGlyph size={14} />
        </span>
      );
  }
}

/** Colonne « destinataire » : intrinsèque (système), ou usage par les actions (réservation). */
function Recipient({ r }: { r: KindData }) {
  if (!r.usage) return <span className="ex-rc">{r.recipient}</span>;
  const { actions, enabled } = r.usage;
  if (actions === 0) {
    return (
      <span
        className="ms-pill is-neutral"
        title="Aucune action de « Échanges par mail » n'utilise ce type"
      >
        non routé
      </span>
    );
  }
  const off = actions - enabled;
  const tone = enabled === 0 ? "is-warn" : "is-ok";
  const text =
    off === 0
      ? `${actions} action${actions > 1 ? "s" : ""}`
      : enabled === 0
        ? `${actions} action${actions > 1 ? "s" : ""}, désactivée${actions > 1 ? "s" : ""}`
        : `${actions} actions, ${off} désactivée${off > 1 ? "s" : ""}`;
  return (
    <span
      className={`ms-pill ${tone}`}
      title="Actions de « Échanges par mail » routées vers ce type (envoi activé ou non)"
    >
      <MailForwardGlyph size={11} /> {text}
    </span>
  );
}

// Mémoïsée : avec des callbacks parent STABLES, une ligne ne se re-rend que si SES données
// changent (et non à chaque frappe ailleurs dans le panneau).
const Row = memo(function Row({
  r,
  canEditMeta = false,
  canDelete = false,
  onEdit,
  onEditMeta,
  onAskDelete,
}: {
  r: KindData;
  // Métadonnées (nom/description) éditables : types perso, ou types intégrés au niveau global.
  canEditMeta?: boolean;
  // Supprimable : types personnalisés uniquement.
  canDelete?: boolean;
  onEdit: (kind: string) => void;
  onEditMeta?: (r: KindData) => void;
  // Demande la suppression : ouvre la modale de confirmation (--danger) au niveau du parent.
  onAskDelete?: (kind: string) => void;
}) {
  return (
    <div className="ex-krow">
      <FamilyIcon r={r} />
      <div style={{ minWidth: 0 }}>
        <div className="ex-knm">{r.label}</div>
        {r.description && (
          <div className="ex-kds" title={r.description}>
            {r.description}
          </div>
        )}
      </div>
      <Recipient r={r} />
      {r.modified ? (
        <span
          className="ms-pill is-warn"
          title="Texte retouché ; « Réinitialiser » dans l'éditeur ramène au défaut"
        >
          <PencilGlyph size={11} /> modifié
        </span>
      ) : (
        <span className="ms-pill is-neutral" title="Texte livré avec l'application">
          par défaut
        </span>
      )}
      <div className="ms-acts">
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => onEdit(r.kind)}
          style={{
            padding: ".2rem .55rem",
            fontSize: ".68rem",
            display: "inline-flex",
            alignItems: "center",
            gap: ".35rem",
            borderColor: "color-mix(in srgb, var(--accent) 40%, transparent)",
            color: "var(--accent)",
          }}
        >
          <PencilGlyph size={12} /> Modifier
        </button>
        {canEditMeta && (
          <button
            type="button"
            className="acct-action"
            onClick={() => onEditMeta?.(r)}
            title="Modifier le nom et la description"
            aria-label={`Modifier le type : ${r.label}`}
          >
            <TagGlyph size={14} />
          </button>
        )}
        {canDelete && (
          <button
            type="button"
            className="acct-action is-danger"
            onClick={() => onAskDelete?.(r.kind)}
            disabled={r.used}
            title={
              r.used
                ? "Type utilisé par au moins une action : retirez-le des actions avant de le supprimer."
                : "Supprimer ce type d'e-mail"
            }
            aria-label={`Supprimer le type : ${r.label}`}
          >
            <TrashGlyph size={14} />
          </button>
        )}
      </div>
    </div>
  );
});

/** Étiquette — nom et description d'un type (trait Tabler). */
function TagGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M7.5 7.5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />
      <path d="M3 6v5.172a2 2 0 0 0 .586 1.414l7.71 7.71a2.41 2.41 0 0 0 3.408 0l5.592 -5.592a2.41 2.41 0 0 0 0 -3.408l-7.71 -7.71a2 2 0 0 0 -1.414 -.586h-5.172a3 3 0 0 0 -3 3z" />
    </svg>
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
