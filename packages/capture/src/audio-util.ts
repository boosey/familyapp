import { createHash } from "node:crypto";

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const EXT_BY_TYPE: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/flac": "flac",
};

export function extensionFor(contentType: string): string {
  return EXT_BY_TYPE[contentType.split(";")[0]!.trim().toLowerCase()] ?? "bin";
}
