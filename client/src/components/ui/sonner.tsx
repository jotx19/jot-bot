"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };

export const CustomToaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      duration={4000}
      position="bottom-right"
      toastOptions={{
        style: {
          borderRadius: "1rem",
          border: `1px solid ${theme === "dark" ? "#333" : "#DDD"}`,
          background: theme === "dark" ? "#1C1C1E" : "#F9F9F9",
          color: theme === "dark" ? "#FFF" : "#111",
          padding: "0.75rem 1rem",
        },
      }}
      {...props}
    />
  );
};
