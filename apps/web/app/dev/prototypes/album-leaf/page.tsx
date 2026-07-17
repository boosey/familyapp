import { redirect } from "next/navigation";
import { AlbumLeafProto } from "./AlbumLeafProto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function AlbumLeafPage() {
  if (process.env.NODE_ENV === "production") redirect("/");
  return <AlbumLeafProto />;
}
