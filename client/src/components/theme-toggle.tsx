"use client";

import { useTheme } from "next-themes";
import { Sun, Moon } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const themes: ("light" | "dark")[] = ["light", "dark"];
  const [activeTheme, setActiveTheme] = useState<"light" | "dark">("dark");

  useEffect(() => {
    if (theme === "light" || theme === "dark") {
      setActiveTheme(theme);
    }
  }, [theme]);

  const icons = {
    light: <Sun className="size-3 text-black dark:text-white" />,
    dark: <Moon className="size-3 text-black dark:text-white" />,
  };

  const labels = {
    light: "Light mode",
    dark: "Dark mode",
  };

  return (
    <div className="flex items-center gap-1 rounded-full border border-border p-0.5 text-muted-foreground">
      {themes.map((t) => (
        <Tooltip key={t}>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => setTheme(t)}
              aria-label={labels[t]}
              className={`rounded-full p-1 transition-colors hover:bg-gray-200 dark:hover:bg-gray-700 ${
                activeTheme === t ? "bg-gray-200 dark:bg-gray-600" : ""
              }`}
            >
              {icons[t]}
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">{labels[t]}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
