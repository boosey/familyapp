/**
 * ActionButton (#7) — the ONE canonical primary action button (see ActionButton.module.css). Renders a
 * Next.js <Link> when given `href`, else a <button>. Keeps every primary CTA (Tell a story, Add Photos,
 * Invite) on one style so they can't drift apart. Server-safe: no hooks, no "use client".
 */
import Link from "next/link";
import type { ReactNode } from "react";
import s from "./ActionButton.module.css";

type BaseProps = {
  children: ReactNode;
  className?: string;
  "aria-label"?: string;
};

type LinkProps = BaseProps & { href: string; onClick?: never; type?: never; disabled?: never };

type ButtonProps = BaseProps & {
  href?: undefined;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
};

export type ActionButtonProps = LinkProps | ButtonProps;

export function ActionButton(props: ActionButtonProps) {
  const className = props.className ? `${s.button} ${props.className}` : s.button;

  if (props.href !== undefined) {
    return (
      <Link href={props.href} className={className} aria-label={props["aria-label"]}>
        {props.children}
      </Link>
    );
  }

  return (
    <button
      type={props.type ?? "button"}
      className={className}
      onClick={props.onClick}
      disabled={props.disabled}
      aria-label={props["aria-label"]}
    >
      {props.children}
    </button>
  );
}
