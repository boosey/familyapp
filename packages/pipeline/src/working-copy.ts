/**
 * Default `WorkingCopyTransformer` — a deterministic, dependency-free implementation usable in
 * tests and as the wired-up default until a real DSP adapter (ffmpeg-wasm / Python sidecar; see
 * OPEN-QUESTIONS) is built. It does NOT actually run VAD or time-stretch on audio bytes.
 *
 * IMPORTANT — honest reporting of what it actually does:
 *   - It reports `speedFactor: 1.0` by default, because the bytes have NOT been sped up. If the
 *     orchestrator persisted timings against a falsely-reported 1.6x, every word timing in
 *     production would be off by ~60% until a real DSP adapter landed. So the default tells the
 *     truth: "no transform applied; this is 1x of the original".
 *   - When a caller (test or real adapter) passes `speedFactor` explicitly, the transformer
 *     reports that — and a real adapter MUST actually apply the corresponding tempo change. The
 *     orchestrator's segment-based 1x mapping is correct given honest input.
 *   - Always returns a SEPARATE Uint8Array (the canonical bytes are not aliased forward).
 *
 * The "hard audio" / low-SNR backoff and per-request stitching live at the contract level only;
 * see OPEN-QUESTIONS for the deferred DSP work that earns its keep when wired to ffmpeg.
 */
import type {
  WorkingCopyInput,
  WorkingCopyResult,
  WorkingCopySegment,
  WorkingCopyTransformer,
} from "./contracts";

export interface DefaultWorkingCopyOptions {
  /** Base tempo factor. Spec default = 1.6. */
  speedFactor?: number;
  /** Hard cap; spec says "never exceed ~2x". */
  maxSpeedFactor?: number;
  /**
   * Optional hint provider. Return `true` to indicate hard/low-SNR audio for this input — the
   * transformer will back the speed factor off toward `lowSnrSpeedFactor` (default 1.4). The
   * default heuristic returns false (no signal in mock bytes); a real adapter would compute SNR.
   */
  isHardAudio?: (input: WorkingCopyInput) => boolean;
  lowSnrSpeedFactor?: number;
}

const DEFAULTS = {
  /**
   * 1.0 = the stub applies NO tempo change, so reporting 1.0 keeps timings honest. A real DSP
   * adapter (the future `FfmpegWorkingCopyTransformer` etc.) will set this to the spec's 1.6
   * because it actually time-stretches. See the module docstring.
   */
  speedFactor: 1.0,
  maxSpeedFactor: 2.0,
  /** Spec: back off toward 1.3–1.4x on low-SNR audio. Real adapters use this; stub does not. */
  lowSnrSpeedFactor: 1.4,
} as const;

export function createDefaultWorkingCopyTransformer(
  opts: DefaultWorkingCopyOptions = {},
): WorkingCopyTransformer {
  const baseSpeed = clamp(opts.speedFactor ?? DEFAULTS.speedFactor, 1.0, opts.maxSpeedFactor ?? DEFAULTS.maxSpeedFactor);
  const lowSnrSpeed = clamp(opts.lowSnrSpeedFactor ?? DEFAULTS.lowSnrSpeedFactor, 1.0, baseSpeed);
  const isHardAudio = opts.isHardAudio ?? (() => false);
  return {
    async transform(input: WorkingCopyInput): Promise<WorkingCopyResult> {
      const hard = isHardAudio(input);
      const speedFactor = hard ? lowSnrSpeed : baseSpeed;
      // Treat the whole audio as one VAD-kept segment in the stub. Real adapters split.
      const originalMs = Math.max(0, Math.round((input.durationSeconds ?? 0) * 1000));
      const workingMs = Math.round(originalMs / speedFactor);
      const segments: WorkingCopySegment[] = [
        {
          originalStartMs: 0,
          originalEndMs: originalMs,
          workingCopyStartMs: 0,
          workingCopyEndMs: workingMs,
        },
      ];
      // Copy so the canonical bytes are never aliased into the working copy.
      const bytes = input.bytes.slice();
      return {
        bytes,
        contentType: input.contentType,
        speedFactor,
        segments,
        notes: hard ? "low-SNR backoff applied" : undefined,
      };
    },
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Map a working-copy timestamp (in milliseconds, sped-up time) back to the ORIGINAL 1x time
 * using the segment table the transformer reported. If the timestamp falls outside every
 * segment (rounding slop at boundaries), it clamps to the nearest segment edge. This is the
 * function the orchestrator uses to persist word timings in 1x time.
 */
export function mapWorkingCopyMsToOriginalMs(
  workingCopyMs: number,
  speedFactor: number,
  segments: WorkingCopySegment[],
): number {
  // Convert sped-up working-copy ms into REAL working-copy ms by * speedFactor? No: the
  // working-copy bytes themselves *are* the sped-up audio, so timings in those bytes are
  // working-copy ms (1x of the *fast* audio). Mapping back to the original 1x means:
  //   original = workingCopyStart_original + (workingCopyMs - workingCopyStart_workingCopy) * speedFactor
  // for the segment that contains `workingCopyMs`.
  for (const s of segments) {
    if (workingCopyMs >= s.workingCopyStartMs && workingCopyMs <= s.workingCopyEndMs) {
      const offsetIntoSegment = workingCopyMs - s.workingCopyStartMs;
      return s.originalStartMs + Math.round(offsetIntoSegment * speedFactor);
    }
  }
  // Outside any segment — clamp to nearest edge so callers never produce NaN/undefined.
  const first = segments[0]!;
  const last = segments[segments.length - 1]!;
  if (workingCopyMs < first.workingCopyStartMs) return first.originalStartMs;
  return last.originalEndMs;
}
