/**
 * The PIPELINE-ONLY subpath of @chronicle/core. Exports the narrow system-actor reads the
 * pipeline uses to load a story (or a single take) + its canonical recording for backend
 * processing.
 *
 * These are CONTENT-SURFACING reads with no `AuthContext` check — they return the storage key,
 * transcript, prose, and prompt question. They are safe ONLY because the pipeline acts on its
 * own derived data (not on behalf of a viewer). To prevent accidental misuse from a user-facing
 * surface (e.g. `apps/web`), these helpers are NOT exported from the package root — importers
 * must reach them via the `@chronicle/core/pipeline` subpath, and the architecture guard fails
 * CI if any file outside the audited allowlist (the pipeline orchestrator and its multi-take
 * module) imports this path.
 *
 * If you find yourself wanting to import from this path: stop and route through
 * `@chronicle/core`'s authorization function instead.
 */
export {
  getStoryAndRecordingForPipeline,
  getStoryRecordingForPipeline,
  type PipelineStoryView,
} from "./story-repository";
// The orphaned-object reaper's (#90) referenced-keys read — a raw dump of every album storage
// key, so it lives behind this subpath too, never the package root.
export { listAlbumPhotoStorageKeys } from "./album-repository";
