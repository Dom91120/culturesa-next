"use client";

import { useState, useTransition } from "react";
import { HourglassGlyph } from "@/components/ui-glyphs";
import { MAX_WAITLIST_QUIET_MINUTES } from "@/lib/waiting-list-quiet";
import { setWaitlistQuietMinutesAction } from "./actions";

/**
 * Réglage GLOBAL du délai de carence de l'attribution automatique (Dom 2026-09-16), sous
 * le tableau des tâches planifiées : la tâche « Liste d'attente » n'apparie un service que
 * si son agenda n'a pas été modifié depuis ce délai — un créneau libéré un instant pendant
 * une manipulation (échange de créneaux…) n'est pas attribué. 0 = aucun délai.
 * Même chrome que le délai des notifications de validation (Échanges).
 */
export function WaitlistQuietField({ initial }: { initial: number }) {
  const [value, setValue] = useState(String(initial));
  const [saved, setSaved] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function save() {
    const n = Number.parseInt(value, 10);
    if (!Number.isInteger(n) || n < 0) {
      setMsg({ ok: false, text: "Saisissez un nombre de minutes (0 = aucun délai)." });
      return;
    }
    if (n === saved) return;
    setMsg(null);
    startTransition(async () => {
      const res = await setWaitlistQuietMinutesAction(n);
      if (!res.ok) {
        setMsg({ ok: false, text: res.error });
        return;
      }
      setSaved(n);
      setMsg({ ok: true, text: "Délai enregistré" });
    });
  }

  return (
    <div className="ex-set">
      <HourglassGlyph size={14} />
      <label htmlFor="waitlist-quiet-minutes">
        Liste d'attente : attribution automatique après
        <input
          id="waitlist-quiet-minutes"
          type="number"
          min={0}
          max={MAX_WAITLIST_QUIET_MINUTES}
          step={1}
          value={value}
          disabled={pending}
          onChange={(e) => setValue(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
          }}
        />
        min de calme
      </label>
      <span className="note">
        {msg ? (
          <span style={{ color: msg.ok ? "var(--accent)" : "var(--danger)" }}>{msg.text}</span>
        ) : (
          <>
            un service dont une réservation ou un créneau vient d&apos;être modifié (échange de
            créneaux en cours, par exemple) est reporté au passage suivant ; 0 = aucun délai
          </>
        )}
      </span>
    </div>
  );
}
