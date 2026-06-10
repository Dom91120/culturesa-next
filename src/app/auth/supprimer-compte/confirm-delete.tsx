"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { confirmAccountDeletionAction } from "./actions";

type Status = "idle" | "done" | "error";

export function ConfirmDelete({ token }: { token: string | null }) {
  const [status, setStatus] = useState<Status>("idle");
  const [pending, startTransition] = useTransition();

  if (!token) {
    return (
      <div className="panel">
        <div className="panel-title">
          <span className="dot" style={{ background: "#e5484d" }} />
          Lien invalide
        </div>
        <p style={{ fontSize: ".9rem" }}>
          Ce lien de suppression est incomplet. Relancez la demande depuis votre espace « Mon compte
          ».
        </p>
      </div>
    );
  }

  function onConfirm() {
    startTransition(async () => {
      const res = await confirmAccountDeletionAction(token as string);
      setStatus(res.ok ? "done" : "error");
    });
  }

  if (status === "done") {
    return (
      <div className="panel">
        <div className="panel-title">
          <span className="dot" />
          Compte supprimé
        </div>
        <p style={{ fontSize: ".9rem" }}>
          Votre compte a été supprimé et vos données personnelles ont été anonymisées. Merci d'avoir
          utilisé CultuRésa.
        </p>
        <Link
          href="/auth/login"
          style={{ color: "var(--accent)", fontWeight: 600, textDecoration: "underline" }}
        >
          Retour à l'accueil
        </Link>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="panel">
        <div className="panel-title">
          <span className="dot" style={{ background: "#e5484d" }} />
          Lien invalide ou expiré
        </div>
        <p style={{ fontSize: ".9rem" }}>
          Ce lien n'est plus valable (il expire au bout de 24&nbsp;h) ou a déjà été utilisé. Si vous
          souhaitez toujours supprimer votre compte, relancez la demande depuis « Mon compte ».
        </p>
      </div>
    );
  }

  return (
    <div
      className="panel"
      style={{ borderColor: "color-mix(in srgb, #e5484d 45%, var(--border))" }}
    >
      <div className="panel-title">
        <span className="dot" style={{ background: "#e5484d" }} />
        Confirmer la suppression de votre compte
      </div>
      <p style={{ fontSize: ".9rem", color: "var(--muted)", margin: ".25rem 0 1rem" }}>
        Cette action est <strong>irréversible</strong> : vos données personnelles seront anonymisées
        et vous serez déconnecté. Cliquez ci-dessous pour confirmer.
      </p>
      <button
        type="button"
        className="btn"
        onClick={onConfirm}
        disabled={pending}
        style={{ background: "#e5484d", color: "#fff", border: "none" }}
      >
        {pending ? "Suppression…" : "Supprimer définitivement mon compte"}
      </button>
    </div>
  );
}
