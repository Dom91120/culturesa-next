"use server";

import { idSchema } from "@/schemas/referentiels";
import { requireUser } from "@/server/guards";
import { cancelUserBooking } from "@/server/services/bookings";
import { revalidatePath } from "next/cache";

export async function cancelBookingAction(formData: FormData) {
  const session = await requireUser();
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return;
  await cancelUserBooking(session.user.id, id.data);
  revalidatePath("/mes-reservations");
}
