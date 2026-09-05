// components/ui/Button.tsx

import { forwardRef, type ButtonHTMLAttributes } from "react";
import clsx from "clsx";

type Variant = "primary" | "secondary" | "danger" | "ghost";
type Size = "sm" | "md";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: "bg-accent text-white hover:bg-accent-dark disabled:bg-ink-faint",
  secondary: "bg-surface text-ink border border-border-strong hover:bg-bg disabled:text-ink-faint",
  danger: "bg-danger text-white hover:bg-danger/90 disabled:bg-ink-faint",
  ghost: "text-ink-muted hover:text-ink hover:bg-bg disabled:text-ink-faint",
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: "text-sm px-2.5 py-1 rounded-sm",
  md: "text-sm px-3.5 py-2 rounded",
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }
>(function Button({ className, variant = "secondary", size = "md", disabled, ...props }, ref) {
  return (
    <button
      ref={ref}
      disabled={disabled}
      className={clsx(
        "inline-flex items-center justify-center gap-1.5 font-medium transition-colors",
        "disabled:cursor-not-allowed",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className
      )}
      {...props}
    />
  );
});
