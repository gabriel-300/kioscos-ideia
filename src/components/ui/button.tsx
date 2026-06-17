"use client";

import { forwardRef } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "gold" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  asChild?: boolean;
}

const variantClasses: Record<Variant, string> = {
  primary:
    "bg-tierra-700 text-white hover:bg-tierra-800 active:scale-[0.98] shadow-sm hover:shadow-md",
  gold:
    "bg-dorado-500 text-neutral-900 hover:bg-dorado-600 active:scale-[0.98] shadow-sm hover:shadow-md font-semibold",
  secondary:
    "bg-neutral-100 text-neutral-900 hover:bg-neutral-200 active:scale-[0.98]",
  ghost:
    "bg-transparent text-neutral-700 border border-neutral-300 hover:border-neutral-500 hover:bg-neutral-50 active:scale-[0.98]",
  danger:
    "bg-danger text-white hover:bg-red-700 active:scale-[0.98] shadow-sm",
};

const sizeClasses: Record<Size, string> = {
  sm: "h-9 px-4 text-sm gap-1.5 rounded-full",
  md: "h-11 px-5 text-sm gap-2 rounded-full",
  lg: "h-13 px-7 text-base gap-2.5 rounded-full",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      loading = false,
      disabled,
      className,
      children,
      asChild: _asChild,
      ...props
    },
    ref
  ) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          "inline-flex items-center justify-center font-medium transition-all duration-150",
          "focus-visible:outline-2 focus-visible:outline-dorado-500 focus-visible:outline-offset-2",
          "disabled:opacity-50 disabled:pointer-events-none",
          variantClasses[variant],
          sizeClasses[size],
          className
        )}
        {...props}
      >
        {loading ? (
          <>
            <span className="size-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
            <span>Cargando…</span>
          </>
        ) : (
          children
        )}
      </button>
    );
  }
);

Button.displayName = "Button";
