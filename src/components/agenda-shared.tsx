"use client";

// Composants PARTAGÉS des deux grilles agenda (admin / usager), extraits à
// l'identique des deux copies locales (audit duplication 2026-06).

import type { Pointage } from "@/lib/agenda-core";

// Pastille de pointage P (présent, vert) / A (absent, rouge) affichée en haut à
// droite du badge, reprise du legacy `_badgeIndicators` (classes .indic_p /
// .indic_a). Le pointage n'existe que sur les réservations ponctuelles datées,
// donc cette pastille n'apparaît qu'en « Semaine réelle ». Le badge parent doit
// être `position: relative` pour l'ancrer.
export function PointagePill({ pointage }: { pointage: Pointage }) {
  if (!pointage) return null;
  return (
    <span
      style={{
        position: "absolute",
        right: 3,
        top: 3,
        display: "flex",
        flexDirection: "column",
        gap: 2,
        alignItems: "center",
        zIndex: 1,
      }}
    >
      <span className={pointage === "present" ? "indic_p" : "indic_a"}>
        {pointage === "present" ? "P" : "A"}
      </span>
    </span>
  );
}

/**
 * Overlay de modale : clic sur le fond ou touche Échap = fermeture. Encapsule les
 * handlers clavier/souris pour rester accessible (et éviter de dupliquer les ignores).
 */
export function ModalOverlay({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="modal-overlay open"
      role="presentation"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <dialog
        open
        className="modal-box"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {children}
      </dialog>
    </div>
  );
}
