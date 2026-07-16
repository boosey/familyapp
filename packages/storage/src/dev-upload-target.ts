import type { UploadTarget } from "./index";

/**
 * Build the dev-only UploadTarget shared by the filesystem + in-memory adapters (issue #20). Neither
 * dev store can presign, so the browser PUTs to the app's dev receiver route instead — the target
 * points at `${uploadBaseUrl}/<url-encoded key>`. The receiver (404 in any durable deploy) re-checks
 * auth, the upload ticket, the `family-photos/` keyspace, and write-once before writing via `put`.
 *
 * The key (`family-photos/<uuid>`) contains a slash, so it is encoded as a SINGLE path segment
 * (`encodeURIComponent`) and the receiver decodes it back — the route is `[key]`, one dynamic segment.
 */
export function devUploadTarget(input: {
  uploadBaseUrl: string | undefined;
  key: string;
  contentType: string;
  expirySeconds: number;
}): UploadTarget {
  if (!input.uploadBaseUrl) {
    // A dev adapter was constructed without an uploadBaseUrl — a wiring bug, not a runtime input
    // error. Fail loud rather than mint a target the browser can't PUT to.
    throw new Error(
      "createUploadTarget requires uploadBaseUrl on the dev MediaStorage adapter (see lib/runtime.ts wiring)",
    );
  }
  const base = input.uploadBaseUrl.replace(/\/+$/, "");
  return {
    method: "PUT",
    url: `${base}/${encodeURIComponent(input.key)}`,
    headers: { "Content-Type": input.contentType },
  };
}
