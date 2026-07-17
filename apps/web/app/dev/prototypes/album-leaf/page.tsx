import { redirect } from "next/navigation";
import { isDevSurfaceEnabled } from "@/lib/dev-surface";
import { AlbumLeafProto } from "./AlbumLeafProto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function AlbumLeafPage() {
  if (!isDevSurfaceEnabled()) redirect("/");
  return <AlbumLeafProto />;
}
