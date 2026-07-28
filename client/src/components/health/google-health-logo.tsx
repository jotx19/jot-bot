import { cn } from "@/lib/utils";

type GoogleHealthLogoProps = {
  className?: string;
  size?: number;
};

/** Google Health–style mark (teal tile + white heart / pulse). */
export function GoogleHealthLogo({
  className,
  size = 48,
}: GoogleHealthLogoProps) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[14px]",
        className
      )}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect width="48" height="48" rx="14" fill="#00C2A8" />
        <path
          d="M24 36.5c-.4 0-.8-.15-1.1-.45C19.2 32.15 14 27.4 14 22.2c0-3.15 2.35-5.7 5.4-5.7 1.7 0 3.25.75 4.6 2.2 1.35-1.45 2.9-2.2 4.6-2.2 3.05 0 5.4 2.55 5.4 5.7 0 5.2-5.2 9.95-8.9 13.85-.3.3-.7.45-1.1.45Z"
          fill="white"
        />
        <path
          d="M16.5 23.5h3.2l1.6-3.8 2.4 7.2 1.7-3.4h6.1"
          stroke="#00C2A8"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
