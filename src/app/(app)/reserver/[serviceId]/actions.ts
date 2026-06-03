"use server";

import type { ActionState } from "@/lib/action-state";
import { bookingCreateSchema } from "@/schemas/booking";
import { requireUser } from "@/server/guards";
import { BookingError, createUniqueBooking } from "@/server/services/bookings";
import { revalidatePath } from "next/cache";

export async function createBookingAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireUser();

  const parsed = bookingCreateSchema.safeParse({
    slotId: formData.get("slotId"),
    enfants: formData.get("enfants") ?? 0,
    accompagnants: formData.get("accompagnants") ?? 0,
    themeLabel: formData.get("themeLabel") ?? "",
  });
  if (!parsed.success) return { ok: false, error: "Données invalides." };

  try {
    await createUniqueBooking(session.user.id, parsed.data);
  } catch (e) {
    if (e instanceof BookingError) return { ok: false, error: e.message };
    throw e;
  }

  revalidatePath("/mes-reservations");
  // Revalide la page du service (où s'affichent les jauges).
  const serviceId = formData.get("serviceId");
  if (typeof serviceId === "string") revalidatePath(`/reserver/${serviceId}`);

  return { ok: true };
}
