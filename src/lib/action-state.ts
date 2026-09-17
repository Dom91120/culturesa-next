/** État renvoyé par les Server Actions utilisées avec `useActionState`. */
export type ActionState = { ok: boolean; error?: string } | null;

export const initialActionState: ActionState = null;

/**
 * Résultat d'une Server Action en UNION DISCRIMINÉE : `ok: true` (+ charge utile `T`)
 * ou `ok: false` avec un `error` TOUJOURS renseigné (+ complément `E`, ex. `needsConfirm`).
 * Remplace les types inline `{ ok: boolean; error?: string; … }` (audit 2026-09-17) : un
 * appelant qui teste `!res.ok` obtient un `error: string`, sans repli « ?? "Échec." » à
 * répéter. `ActionState` est conservé pour `useActionState` (compatibilité).
 */
export type ActionResult<
  T extends object = Record<never, never>,
  E extends object = Record<never, never>,
> = ({ ok: true } & T) | ({ ok: false; error: string } & E);
