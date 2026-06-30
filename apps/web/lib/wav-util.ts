/**
 * Synthetic WAV bytes — the single source of truth for both the dev seed (lib/dev-seed.ts) and the
 * e2e tests (e2e/support/seed.ts). Kept dependency-free and free of "server-only" so it is importable
 * from the Playwright (Node) test context as well as the Next server runtime.
 *
 * Previously each side had its own copy; the ScriptedTranscriber ignores audio content, so any
 * divergence between the two would have gone undetected by tests. One implementation removes that
 * latent hazard.
 */

/** A 1-second mono 8 kHz 16-bit PCM WAV of silence. Smallest valid playable thing. */
export function tinyWav(): Uint8Array {
  const sampleRate = 8000;
  const numSamples = sampleRate;
  const dataSize = numSamples * 2;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  const writeAscii = (offset: number, s: string): void => {
    for (let i = 0; i < s.length; i++) v.setUint8(offset + i, s.charCodeAt(i));
  };
  writeAscii(0, "RIFF");
  v.setUint32(4, 36 + dataSize, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  writeAscii(36, "data");
  v.setUint32(40, dataSize, true);
  return new Uint8Array(buf);
}
