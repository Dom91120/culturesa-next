/** Formate une Date (ou null) en "YYYY-MM-DD" pour un <input type="date">. */
export function toDateInput(d: Date | null | undefined): string {
  if (!d) return "";
  return d.toISOString().slice(0, 10);
}
