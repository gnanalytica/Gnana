"use client";

import { useTheme } from "next-themes";
import { Sun, Moon, Monitor } from "lucide-react";
import { cn } from "@/lib/utils";

const themes = ["system", "light", "dark"] as const;
const themeIcons = {
  system: Monitor,
  light: Sun,
  dark: Moon,
} as const;

export function ThemeToggle({ isCollapsed }: { isCollapsed: boolean }) {
  const { theme, setTheme } = useTheme();

  const currentTheme = (theme ?? "system") as (typeof themes)[number];
  const Icon = themeIcons[currentTheme] ?? Monitor;

  const cycleTheme = () => {
    const currentIndex = themes.indexOf(currentTheme);
    const nextIndex = (currentIndex + 1) % themes.length;
    const nextTheme = themes[nextIndex] ?? "system";
    setTheme(nextTheme);
  };

  return (
    <button
      onClick={cycleTheme}
      className={cn(
        "flex items-center gap-3 rounded-md text-sm font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-accent-foreground",
        isCollapsed ? "justify-center w-10 h-10" : "px-3 py-2",
      )}
      aria-label={`Current theme: ${currentTheme}. Click to cycle.`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {!isCollapsed && <span className="truncate capitalize">{currentTheme}</span>}
    </button>
  );
}
