/**
 * Product mark for Tell Me Again — the five-petal logo used as favicon / app icon.
 * Served from `/logo.png` (transparent PNG). Presentational; safe in server components.
 * Decorative when paired with visible brand text (`aria-hidden`).
 */
export function BrandMark({
  size = 40,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <img
      src="/logo.png"
      alt=""
      width={size}
      height={size}
      className={className}
      decoding="async"
      aria-hidden
    />
  );
}
