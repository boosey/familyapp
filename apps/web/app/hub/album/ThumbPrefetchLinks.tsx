/**
 * ThumbPrefetchLinks (#371) — server-rendered cache-warming for album thumbnails.
 *
 * The album tab is only server-rendered when `?tab=album`, so on a normal hub load (the Stories tab)
 * the album's photos are never fetched and nothing warms their thumbnails. This tiny SERVER component
 * (no client JS) emits a `<link rel="prefetch" as="image">` per photo id, so the browser warms the
 * first screenful of thumbnails at IDLE / low priority while the viewer is on another tab. Switching to
 * the Album tab then hits the cache instead of the network.
 *
 * Why `rel="prefetch"` (not `preload`): prefetch is the lowest-priority "probably needed soon" hint and,
 * unlike `preload`, emits NO "resource was preloaded but not used" console warning when the viewer never
 * opens the album — which is the common case, since this warms on EVERY hub load. It never competes with
 * visible content.
 *
 * Auth is unchanged: the href is the SAME audited byte route the tiles use (`albumPhotoSrc(id,{thumb})`),
 * a same-origin request that carries the session cookie, so `/api/album-photo/[id]` re-checks read
 * authorization on every warmed byte exactly as it does for a rendered tile. This component only builds
 * URLs — it never grants access.
 *
 * Tiles keep `loading="lazy"` (+ `content-visibility` on grid tiles, #219); warming is purely additive
 * and cannot change what any tile renders.
 */
import { albumPhotoSrc } from "./photo-src";

export function ThumbPrefetchLinks({ ids }: { ids: string[] }): React.ReactElement {
  return (
    <>
      {ids.map((id) => (
        <link key={id} rel="prefetch" as="image" href={albumPhotoSrc(id, { thumb: true })} />
      ))}
    </>
  );
}
