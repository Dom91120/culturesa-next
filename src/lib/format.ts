/** Formate une Date (ou null) en "YYYY-MM-DD" pour un <input type="date">. */
export function toDateInput(d: Date | null | undefined): string {
  if (!d) return "";
  return d.toISOString().slice(0, 10);
}

/**
 * Formate un numéro de téléphone FR en groupes de 2 chiffres : "06 12 34 56 78".
 * Renvoie "—" si vide, ou la valeur brute si ce n'est pas un 10 chiffres.
 * (Réimplémente formatTel du legacy public/js/app.js.)
 */
export function formatTel(tel: string | null | undefined): string {
  if (!tel) return "—";
  const d = tel.replace(/\D/g, "");
  if (d.length !== 10) return tel;
  return (d.match(/.{2}/g) ?? []).join(" ");
}
