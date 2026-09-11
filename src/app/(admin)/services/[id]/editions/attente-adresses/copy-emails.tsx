"use client";

import { useEffect, useRef, useState } from "react";
import { CircleCheckGlyph } from "@/components/ui-glyphs";

/** Pictogramme « copier » (deux feuilles), même trait que les autres glyphes de l'app. */
function CopyGlyph({ size = 14 }: { size?: number }) {
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
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </svg>
  );
}

/**
 * Bloc « Adresses e-mail à copier » : intertitre avec un bouton qui copie la liste dans le
 * presse-papiers (retour « Copié » deux secondes), et la zone de texte prête à coller.
 */
export function CopyEmails({ emails }: { emails: string[] }) {
  const text = emails.join("; ");
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Presse-papiers indisponible (contexte non sécurisé) : la zone de texte reste
      // sélectionnable à la main.
    }
  }

  return (
    <div className="no-print">
      <div className="ms-grp">
        Adresses e-mail à copier
        <span className="hint">
          · {emails.length} adresse{emails.length > 1 ? "s" : ""}, séparées par « ; »
        </span>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={copy}
          title="Copier les adresses dans le presse-papiers"
          style={{
            order: 1,
            marginLeft: ".6rem",
            padding: ".18rem .55rem",
            fontSize: ".66rem",
            display: "inline-flex",
            alignItems: "center",
            gap: ".35rem",
            color: copied ? "var(--accent)" : undefined,
            borderColor: copied ? "color-mix(in srgb, var(--accent) 45%, transparent)" : undefined,
          }}
        >
          {copied ? <CircleCheckGlyph size={13} strokeWidth={2.2} /> : <CopyGlyph size={13} />}
          {copied ? "Copié" : "Copier"}
        </button>
      </div>
      <textarea
        readOnly
        rows={Math.min(6, Math.ceil(emails.length / 3) + 1)}
        value={text}
        onFocus={(e) => e.currentTarget.select()}
        style={{
          width: "100%",
          fontSize: ".78rem",
          fontFamily: "inherit",
          padding: ".5rem .6rem",
          borderRadius: 6,
          border: "1px solid var(--border)",
          background: "var(--surface1)",
          color: "var(--text)",
          resize: "vertical",
        }}
      />
      <p style={{ fontSize: ".72rem", color: "var(--muted)", margin: ".3rem 0 0" }}>
        À coller dans le champ « Cci » de votre messagerie.
      </p>
    </div>
  );
}
