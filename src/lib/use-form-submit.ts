"use client";

import { type FormEvent, useState } from "react";

/**
 * Mutualise le boilerplate des formulaires auth en `onSubmit` manuel (login /
 * forgot-password / reset-password) : états `pending` + `error`, `preventDefault`,
 * remise à zéro de l'erreur, bascule de `pending` et garde try/catch.
 *
 * `onSubmit(handler)` renvoie le gestionnaire à brancher sur `<form onSubmit>`. Le
 * `handler` reçoit le `FormData` du formulaire et RENVOIE un message d'erreur (string)
 * à afficher, ou rien en cas de succès (navigation / effet de succès faits dans le
 * handler lui-même). Toute exception est rattrapée et affichée.
 */
export function useFormSubmit() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit =
    // biome-ignore lint/suspicious/noConfusingVoidType: void = handler sans message (succès)
      (handler: (form: FormData) => Promise<string | void>) =>
      async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setError(null);
        const form = new FormData(e.currentTarget);
        setPending(true);
        try {
          const msg = await handler(form);
          if (msg) setError(msg);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Une erreur est survenue. Réessayez.");
        } finally {
          setPending(false);
        }
      };

  return { pending, error, setError, onSubmit };
}
