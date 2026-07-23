"use client";

import { EMAIL_THEME as t } from "@/lib/email-theme";

/**
 * Habillage e-mail reproduit en DOM (miroir visuel de wrapEmailHtml, lib/email-theme.ts)
 * pour l'édition « dans l'aperçu » : l'en-tête (logo Ville de Châtillon), le pied et le
 * fond sont affichés mais INERTES ; `children` est la zone éditable (corps du message).
 * Le rendu de référence reste l'aperçu iframe (wrapEmailHtml), utilisé pour l'envoi.
 */
export function EmailFrame({ children }: { children: React.ReactNode }) {
  const arial = "Arial,Helvetica,sans-serif" as const;
  return (
    <div
      className="em-edit"
      style={{
        background: t.pageBg,
        padding: "0 12px",
        border: "1px solid var(--border)",
        borderRadius: 6,
      }}
    >
      <div
        style={{
          maxWidth: 600,
          margin: "0 auto",
          background: t.card,
          border: `1px solid ${t.border}`,
          borderRadius: 12,
          overflow: "hidden",
          fontFamily: arial,
        }}
      >
        <div style={{ height: 6, background: t.green }} />
        <div
          style={{
            background: t.headerBg,
            padding: "18px 28px",
            display: "flex",
            alignItems: "center",
            gap: 14,
          }}
        >
          {/* Aperçu éditeur : URL publique du logo (les envois réels utilisent le CID inline). */}
          <img
            src="/email-logo.png"
            alt="Ville de Châtillon"
            style={{ display: "block", height: 54, width: "auto" }}
          />
          <div style={{ flex: 1, fontSize: 20, fontWeight: "bold", color: t.green }}>
            Ville de Châtillon
          </div>
          <div style={{ fontSize: 12, color: t.muted, letterSpacing: ".04em" }}>CultuRésa</div>
        </div>

        {children}

        <div
          style={{
            background: t.green,
            padding: "16px 28px",
            color: t.headerBg,
            fontSize: 12,
            lineHeight: 1.5,
          }}
        >
          Ville de Châtillon — Portail CultuRésa
          <br />
          Message automatique, merci de ne pas répondre à cet e-mail.
        </div>
      </div>
      <div
        style={{
          fontSize: 11,
          color: t.muted,
          padding: 12,
          textAlign: "center",
          fontFamily: arial,
        }}
      >
        © Ville de Châtillon
      </div>
    </div>
  );
}
