import { getService } from "@/server/services/services";
import { getServiceThemes } from "@/server/services/themes";
import { notFound } from "next/navigation";
import { ParamsSubnav } from "../params-subnav";
import { ThemesPanel } from "./themes-panel";

export default async function ThemesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const service = await getService(id);
  if (!service) notFound();

  const { mode, themes } = await getServiceThemes(id);

  return (
    <div>
      <ParamsSubnav serviceId={id} />
      <ThemesPanel serviceId={id} initialMode={mode} initialThemes={themes} />
    </div>
  );
}
