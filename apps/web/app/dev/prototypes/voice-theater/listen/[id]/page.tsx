import { redirect, notFound } from "next/navigation";
import { isDevSurfaceEnabled } from "@/lib/dev-surface";
import { getProtoStory } from "../../../mock-data";
import { ListenStage } from "./ListenStage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ListenPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!isDevSurfaceEnabled()) redirect("/");
  const { id } = await params;
  const story = getProtoStory(id);
  if (!story) notFound();
  return <ListenStage story={story} />;
}
