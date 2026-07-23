"use client";

import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import TextAlign from "@tiptap/extension-text-align";
import { Color, TextStyle } from "@tiptap/extension-text-style";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

type Props = {
  initialHtml: string;
  variables: { name: string; desc: string }[];
  ariaLabel: string;
  onChange: (html: string) => void;
  // Habille la ZONE ÉDITABLE (et elle seule) — la barre d'outils et les variables restent
  // en dehors. Utilisé pour l'édition « dans l'aperçu » des e-mails (cf. EmailFrame).
  renderFrame?: (editorContent: React.ReactNode) => React.ReactNode;
  // Boutons d'action (Réinitialiser / Enregistrer…) affichés à droite du bloc Variables,
  // juste sous la zone d'édition.
  actions?: React.ReactNode;
};

// Éditeur de texte enrichi (WYSIWYG) basé sur Tiptap/ProseMirror, produisant du HTML :
// mise en forme, titres, listes, citations, liens, alignement, couleur, surlignage,
// images et tableaux.
export function RichTextEditor({
  initialHtml,
  variables,
  ariaLabel,
  onChange,
  renderFrame,
  actions,
}: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Image.configure({ inline: false }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: initialHtml,
    immediatelyRender: false, // Next/SSR : évite tout décalage d'hydratation.
    editorProps: {
      attributes: {
        "aria-label": ariaLabel,
        role: "textbox",
        "aria-multiline": "true",
        class: "rte-content",
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  if (!editor) {
    return (
      <div
        className="rte"
        style={{ minHeight: 240, border: "1px solid var(--border)", borderRadius: 6 }}
      />
    );
  }

  function setLink() {
    const prev = editor?.getAttributes("link").href as string | undefined;
    const url = window.prompt("URL du lien (vide pour retirer) :", prev ?? "https://");
    if (url === null) return;
    if (url === "") {
      editor?.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor?.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }

  function addImage() {
    const url = window.prompt("URL de l'image :", "https://");
    if (url) editor?.chain().focus().setImage({ src: url }).run();
  }

  const inTable = editor.isActive("table");

  return (
    <div className="rte">
      <div className="rte-toolbar">
        <Btn
          active={editor.isActive("bold")}
          title="Gras"
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <strong>G</strong>
        </Btn>
        <Btn
          active={editor.isActive("italic")}
          title="Italique"
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <em>I</em>
        </Btn>
        <Btn
          active={editor.isActive("underline")}
          title="Souligné"
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        >
          <span style={{ textDecoration: "underline" }}>S</span>
        </Btn>
        <Btn
          active={editor.isActive("strike")}
          title="Barré"
          onClick={() => editor.chain().focus().toggleStrike().run()}
        >
          <span style={{ textDecoration: "line-through" }}>S</span>
        </Btn>

        <span className="rte-sep" />

        {/* Couleur du texte / surlignage : input natif, .focus() restaure la sélection. */}
        <label className="rte-color" title="Couleur du texte">
          <span style={{ fontSize: ".72rem" }}>A</span>
          <input
            type="color"
            onChange={(e) => editor.chain().focus().setColor(e.target.value).run()}
          />
        </label>
        <Btn title="Retirer la couleur" onClick={() => editor.chain().focus().unsetColor().run()}>
          A⌫
        </Btn>
        <label className="rte-color" title="Surlignage">
          <span style={{ fontSize: ".72rem" }}>🖍</span>
          <input
            type="color"
            onChange={(e) => editor.chain().focus().setHighlight({ color: e.target.value }).run()}
          />
        </label>
        <Btn
          title="Retirer le surlignage"
          onClick={() => editor.chain().focus().unsetHighlight().run()}
        >
          🖍⌫
        </Btn>

        <span className="rte-sep" />

        <Btn
          active={editor.isActive("heading", { level: 2 })}
          title="Titre"
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          T
        </Btn>
        <Btn
          active={editor.isActive("bulletList")}
          title="Liste à puces"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          • Liste
        </Btn>
        <Btn
          active={editor.isActive("orderedList")}
          title="Liste numérotée"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          1. Liste
        </Btn>
        <Btn
          active={editor.isActive("blockquote")}
          title="Citation"
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        >
          ❝
        </Btn>

        <span className="rte-sep" />

        <Btn
          active={editor.isActive({ textAlign: "left" })}
          title="Aligner à gauche"
          onClick={() => editor.chain().focus().setTextAlign("left").run()}
        >
          ⬅
        </Btn>
        <Btn
          active={editor.isActive({ textAlign: "center" })}
          title="Centrer"
          onClick={() => editor.chain().focus().setTextAlign("center").run()}
        >
          ⬌
        </Btn>
        <Btn
          active={editor.isActive({ textAlign: "right" })}
          title="Aligner à droite"
          onClick={() => editor.chain().focus().setTextAlign("right").run()}
        >
          ➡
        </Btn>
        <Btn
          active={editor.isActive({ textAlign: "justify" })}
          title="Justifier"
          onClick={() => editor.chain().focus().setTextAlign("justify").run()}
        >
          ☰
        </Btn>

        <span className="rte-sep" />

        <Btn active={editor.isActive("link")} title="Lien" onClick={setLink}>
          🔗
        </Btn>
        <Btn title="Insérer une image" onClick={addImage}>
          🖼
        </Btn>
        <Btn
          title="Insérer un tableau"
          onClick={() =>
            editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
          }
        >
          ▦
        </Btn>
        {inTable && (
          <>
            <Btn
              title="Ajouter une colonne"
              onClick={() => editor.chain().focus().addColumnAfter().run()}
            >
              +Col
            </Btn>
            <Btn
              title="Ajouter une ligne"
              onClick={() => editor.chain().focus().addRowAfter().run()}
            >
              +Lig
            </Btn>
            <Btn
              title="Supprimer la colonne"
              onClick={() => editor.chain().focus().deleteColumn().run()}
            >
              −Col
            </Btn>
            <Btn
              title="Supprimer la ligne"
              onClick={() => editor.chain().focus().deleteRow().run()}
            >
              −Lig
            </Btn>
            <Btn
              title="Supprimer le tableau"
              onClick={() => editor.chain().focus().deleteTable().run()}
            >
              ✕▦
            </Btn>
          </>
        )}

        <span className="rte-sep" />

        <Btn title="Annuler" onClick={() => editor.chain().focus().undo().run()}>
          ↶
        </Btn>
        <Btn title="Rétablir" onClick={() => editor.chain().focus().redo().run()}>
          ↷
        </Btn>
        <Btn
          title="Effacer la mise en forme"
          onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
        >
          ⌫ format
        </Btn>
      </div>

      {renderFrame ? (
        renderFrame(<EditorContent editor={editor} />)
      ) : (
        <EditorContent editor={editor} />
      )}

      <div style={{ marginTop: ".4rem", display: "flex", alignItems: "flex-start", gap: ".8rem" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: ".72rem", color: "var(--muted)", marginBottom: ".25rem" }}>
            Variables (cliquer pour insérer au curseur) :
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: ".3rem" }}>
            {variables.map((v) => (
              <button
                key={v.name}
                type="button"
                title={v.desc}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => editor.chain().focus().insertContent(`{{${v.name}}}`).run()}
                style={{
                  fontSize: ".72rem",
                  fontFamily: "monospace",
                  padding: ".15rem .2rem",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  background: "var(--surface2)",
                  color: "var(--text)",
                  cursor: "pointer",
                }}
              >
                {`{{${v.name}}}`}
              </button>
            ))}
          </div>
        </div>
        {actions && <div style={{ flexShrink: 0 }}>{actions}</div>}
      </div>
    </div>
  );
}

function Btn({
  active,
  title,
  onClick,
  children,
}: {
  active?: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      style={{
        fontSize: ".76rem",
        minWidth: 28,
        padding: ".2rem .45rem",
        border: "1px solid var(--border)",
        borderRadius: 4,
        background: active
          ? "color-mix(in srgb, var(--accent) 25%, transparent)"
          : "var(--surface2)",
        color: active ? "var(--accent)" : "var(--text)",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}
