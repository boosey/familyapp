/**
 * ActionButton (#7) — the ONE canonical action button (see ActionButton.module.css). Renders a
 * Next.js <Link> when given `href`, else a <button>. Keeps every CTA on one skin-system style so they
 * can't drift apart. Three emphasis levels via `variant`:
 *   - "primary" (default) — the bright coral→amber fill + card shelf (Tell a story, Add Photos, Invite).
 *   - "secondary" — outlined, quiet.
 *   - "ghost" — text-only accent action.
 * This is also the successor to the retired <KindredButton>: `label`, `fullWidth`, `variant`, and the
 * `name`/`value` button attributes are supported so it drops in for the old flat button one-for-one,
 * at one compact size (the old size="default"/"large" oversizing is gone). Server-safe: no hooks, no
 * "use client" — hover is pure CSS.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import s from "./ActionButton.module.css";

export type ActionButtonVariant = "primary" | "secondary" | "ghost";

type BaseProps = {
  children?: ReactNode;
  /** Text content fallback when no children are given (compat with the retired KindredButton API). */
  label?: string;
  variant?: ActionButtonVariant;
  fullWidth?: boolean;
  className?: string;
  "aria-label"?: string;
  "data-testid"?: string;
};

type LinkProps = BaseProps & {
  href: string;
  onClick?: never;
  type?: never;
  disabled?: never;
  name?: never;
  value?: never;
};

type ButtonProps = BaseProps & {
  href?: undefined;
  onClick?: () => void;
  type?: "button" | "submit" | "reset";
  disabled?: boolean;
  name?: string;
  value?: string;
};

export type ActionButtonProps = LinkProps | ButtonProps;

export function ActionButton(props: ActionButtonProps) {
  const { variant = "primary", fullWidth, className, label, children } = props;
  const classes = [s.button, s[variant], fullWidth ? s.fullWidth : "", className]
    .filter(Boolean)
    .join(" ");
  const content = children ?? label;

  if (props.href !== undefined) {
    return (
      <Link
        href={props.href}
        className={classes}
        aria-label={props["aria-label"]}
        data-testid={props["data-testid"]}
      >
        {content}
      </Link>
    );
  }

  return (
    <button
      type={props.type ?? "button"}
      className={classes}
      onClick={props.onClick}
      disabled={props.disabled}
      name={props.name}
      value={props.value}
      aria-label={props["aria-label"]}
      data-testid={props["data-testid"]}
    >
      {content}
    </button>
  );
}
