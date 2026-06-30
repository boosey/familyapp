/**
 * Logging decorators for the AI vendor seams. Wrapping the concrete adapter ONCE (in the runtime
 * wiring) means every call through the seam is logged — transcribe, story render, post-approval
 * biographical augmentation, intake extraction — without each call site having to opt in.
 *
 * The wrappers are TRANSPARENT: they pass the request through unchanged and return the inner
 * result unchanged; they only observe (timing + sizes + a preview) and re-throw on error. They add
 * no behavior, so they are safe to leave wired in (logging itself is gated in `logger.ts`).
 */
import type {
  LanguageModel,
  LanguageModelRequest,
  LanguageModelResponse,
  Transcriber,
  TranscribeInput,
  TranscriptionResult,
} from "./contracts";
import { errMsg, plog, plogError, preview, startTimer } from "./logger";

/** Wrap a `Transcriber` so each `transcribe` call logs input size, latency, model, and output. */
export function withTranscriberLogging(inner: Transcriber, label = "transcriber"): Transcriber {
  return {
    async transcribe(input: TranscribeInput): Promise<TranscriptionResult> {
      const done = startTimer();
      plog("ai", `${label}.transcribe ←`, {
        bytes: input.bytes.length,
        contentType: input.contentType,
      });
      try {
        const res = await inner.transcribe(input);
        plog("ai", `${label}.transcribe →`, {
          ms: done(),
          model: res.modelId,
          textChars: res.text.length,
          words: res.words.length,
          text: preview(res.text),
        });
        return res;
      } catch (err) {
        plogError("ai", `${label}.transcribe ✗`, { ms: done(), error: errMsg(err) });
        throw err;
      }
    },
  };
}

/** Wrap a `LanguageModel` so each `complete` call logs prompt size, params, latency, and output. */
export function withLanguageModelLogging(inner: LanguageModel, label = "languageModel"): LanguageModel {
  return {
    async complete(req: LanguageModelRequest): Promise<LanguageModelResponse> {
      const done = startTimer();
      const promptChars = req.messages.reduce((n, m) => n + m.content.length, 0);
      plog("ai", `${label}.complete ←`, {
        msgs: req.messages.length,
        promptChars,
        responseFormat: req.responseFormat,
        temperature: req.temperature,
        maxOutputTokens: req.maxOutputTokens,
      });
      try {
        const res = await inner.complete(req);
        plog("ai", `${label}.complete →`, {
          ms: done(),
          model: res.modelId,
          textChars: res.text.length,
          text: preview(res.text),
        });
        return res;
      } catch (err) {
        plogError("ai", `${label}.complete ✗`, { ms: done(), error: errMsg(err) });
        throw err;
      }
    },
  };
}
