/**
 * Journal applicatif structuré (constat D8).
 *
 * ── Ce que remplaçait `console.error("[module]", e)` ──
 * Une trentaine d'appels dispersés, au format libre, sans niveau exploitable ni
 * moyen de relier deux lignes d'une même requête. Lisibles à l'œil dans
 * `docker compose logs`, inexploitables par un outil : impossible de filtrer sur un
 * niveau, de compter les occurrences d'un module, ou de suivre un incident.
 *
 * ── Une ligne JSON par événement, en production seulement ──
 * En développement, le format lisible est conservé : une ligne JSON de 200
 * caractères au milieu d'un rechargement à chaud n'aide personne, et un journal
 * qu'on renonce à lire ne sert à rien. La structure ne vaut que là où une machine
 * la consomme.
 *
 * ── Le champ qui justifie l'exercice : `req` ──
 * L'identifiant de requête, posé par le middleware et renvoyé au client dans
 * `x-request-id`. C'est lui qui relie « l'écran a affiché une erreur » aux lignes
 * de journal correspondantes — sans quoi diagnostiquer revient à corréler à la
 * minute près.
 */

type Niveau = "info" | "avert" | "erreur";
type Meta = Record<string, unknown>;

/**
 * Clés dont la valeur n'est JAMAIS écrite, quel que soit l'appelant.
 *
 * Un journal structuré invite à passer des objets entiers (« c'est plus pratique »),
 * et un objet entier finit par contenir un mot de passe, un jeton ou un cookie. La
 * discipline de l'appelant ne suffit pas : elle tient jusqu'au premier ajout fait
 * dans l'urgence. Le filtre est donc dans le journal, pas dans la consigne.
 */
const CLES_SENSIBLES =
  /^(password|mot_?de_?passe|secret|token|jeton|cookie|authorization|session|api[_-]?key|cle)$/i;

function assainir(v: unknown, profondeur = 0): unknown {
  // Bornée : un objet cyclique ou très profond ne doit pas faire tomber le journal.
  if (profondeur > 4) return "[…]";
  if (v instanceof Error) return { nom: v.name, message: v.message, pile: v.stack };
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => assainir(x, profondeur + 1));
  if (v && typeof v === "object") {
    const out: Meta = {};
    for (const [k, val] of Object.entries(v as Meta)) {
      out[k] = CLES_SENSIBLES.test(k) ? "[masqué]" : assainir(val, profondeur + 1);
    }
    return out;
  }
  return v;
}

function ecrire(niveau: Niveau, module: string, message: string, meta?: Meta): void {
  try {
    const base = { niveau, module, message, ...(meta ? (assainir(meta) as Meta) : {}) };
    const ligne =
      process.env.NODE_ENV === "production"
        ? JSON.stringify({ t: new Date().toISOString(), ...base })
        : `[${module}] ${message}${meta ? ` ${JSON.stringify(assainir(meta))}` : ""}`;
    if (niveau === "erreur") console.error(ligne);
    else if (niveau === "avert") console.warn(ligne);
    else console.log(ligne);
  } catch {
    // Un journal qui lève est pire que pas de journal : il fait échouer l'opération
    // qu'il devait seulement décrire. Le silence est ici le moindre mal.
  }
}

export const journal = {
  info: (module: string, message: string, meta?: Meta) => ecrire("info", module, message, meta),
  avert: (module: string, message: string, meta?: Meta) => ecrire("avert", module, message, meta),
  erreur: (module: string, message: string, meta?: Meta) => ecrire("erreur", module, message, meta),
};

/** Exporté pour les tests : la liste de masquage est le cœur de la protection. */
export const _assainir = assainir;
