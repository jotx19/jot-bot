import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Shared card surface — matches Health dashboard tiles. */
export const panelBg = "bg-[#FCFCFC] dark:bg-[#1C1C1C]";
