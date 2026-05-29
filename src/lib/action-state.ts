/** État renvoyé par les Server Actions utilisées avec `useActionState`. */
export type ActionState = { ok: boolean; error?: string } | null;

export const initialActionState: ActionState = null;
