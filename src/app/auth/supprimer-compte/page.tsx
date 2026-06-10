import { ConfirmDelete } from "./confirm-delete";

export default async function SupprimerComptePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return <ConfirmDelete token={token ?? null} />;
}
