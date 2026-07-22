"use client";

import { cn } from "@/lib/utils";

type TinyjotLogoProps = {
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
};

const boxes = {
  sm: "size-7",
  md: "size-9",
  lg: "size-11",
  xl: "size-14",
} as const;

/** Stylized mark — white glyph on black rounded square. */
export function TinyjotLogo({ className, size = "md" }: TinyjotLogoProps) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 overflow-hidden rounded-xl bg-black",
        boxes[size],
        className
      )}
      aria-hidden
    >
      <svg
        viewBox="0 0 100 100"
        xmlns="http://www.w3.org/2000/svg"
        className="size-full"
      >
        <path
          fill="#fff"
          d="M20 25.5H81.5V41H46.31A44 44 0 0 1 66.07 71.88L52.7 73.76A30.5 30.5 0 0 0 22.5 47.5H20V25.5Z"
        />
      </svg>
      <span className="sr-only">tinyjot</span>
    </span>
  );
}

export default TinyjotLogo;
