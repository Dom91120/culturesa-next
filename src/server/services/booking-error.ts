/**
 * Erreur MÉTIER d'une opération de réservation (message affichable tel quel à
 * l'usager ou au gestionnaire), distincte des erreurs techniques Prisma.
 *
 * Module minuscule et sans dépendance : il casse le cycle bookings ↔ booking-lock
 * (le verrou pointage a besoin de l'erreur, la couche réservations a besoin du verrou).
 * `bookings.ts` la ré-exporte : les appelants existants n'ont rien à changer.
 */
export class BookingError extends Error {}
