"use client";

import { signOut } from "@/lib/auth-client";
import { useRouter } from "next/navigation";

export function SignOutButton() {
  const router = useRouter();

  async function onClick() {
    await signOut();
    router.push("/auth/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="text-sm text-neutral-500 hover:text-brand-700"
    >
      Déconnexion
    </button>
  );
}
