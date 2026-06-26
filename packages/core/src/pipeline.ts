/**
 * The PIPELINE-ONLY subpath of @chronicle/core. Exports the narrow system-actor read used by
 * the orchestrator to load a story + its canonical recording for backend processing.
 *
 * This is a CONTENT-SURFACING read with no `AuthContext` check — it returns the storage key,
 * transcript, prose, and prompt question. The function is safe ONLY because the pipeline acts
 * on its own derived data (not on behalf of a viewer). To prevent accidental misuse from a
 * user-facing surface (e.g. `apps/web`), this helper is NOT exported from the package root —
 * importers must reach it via the `@chronicle/core/pipeline` subpath, and the architecture
 * guard fails CI if any file other than `packages/pipeline/src/orchestrator.ts` imports it.
 *
 * If you find yourself wanting to import from this path: stop and route through
 * `@chronicle/core`'s authorization function instead.
 */
export {
  getStoryAndRecordingForPipeline,
  type PipelineStoryView,
} from "./story-repository";
