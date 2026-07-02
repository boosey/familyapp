/**
 * Intake transcription — a thin, story-decoupled use of the Transcriber vendor seam. Intake clips
 * are short single answers, so we transcribe the RAW bytes directly: no working-copy VAD/speedup
 * (a story-pipeline optimization for long recordings) and no word timings (there is no intake
 * playback to sync). No JobQueue, no render_story. The caller persists the transcript via
 * @chronicle/core's intake repository.
 */
import type { Transcriber } from "./contracts";

export interface IntakeAudio {
  bytes: Uint8Array;
  contentType: string;
}

export async function transcribeIntakeAudio(
  transcriber: Transcriber,
  audio: IntakeAudio,
): Promise<{ text: string; modelId: string }> {
  const result = await transcriber.transcribe({ bytes: audio.bytes, contentType: audio.contentType });
  return { text: result.text, modelId: result.modelId };
}
