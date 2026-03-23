"use client";

import { useCallback, useRef, useState } from "react";
import {
  LayoutDashboard,
  Bot,
  Play,
  Plug,
  Settings,
  Pin,
  PinOff,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarItem } from "./sidebar-item";
import { ThemeToggle } from "./theme-toggle";

const navItems = [
  { icon: LayoutDashboard, label: "Home", href: "/" },
  { icon: Bot, label: "Agents", href: "/agents" },
  { icon: Play, label: "Runs", href: "/runs" },
  { icon: Plug, label: "Connectors", href: "/connectors" },
  { icon: Settings, label: "Settings", href: "/settings" },
] as const;

export function Sidebar() {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [isPinned, setIsPinned] = useState(false);
  const enterTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleMouseEnter = useCallback(() => {
    if (isPinned) return;
    enterTimeoutRef.current = setTimeout(() => {
      setIsCollapsed(false);
    }, 150);
  }, [isPinned]);

  const handleMouseLeave = useCallback(() => {
    if (enterTimeoutRef.current) {
      clearTimeout(enterTimeoutRef.current);
      enterTimeoutRef.current = null;
    }
    if (!isPinned) {
      setIsCollapsed(true);
    }
  }, [isPinned]);

  const togglePin = useCallback(() => {
    setIsPinned((prev) => {
      if (prev) {
        // Unpinning — collapse the sidebar
        setIsCollapsed(true);
      }
      return !prev;
    });
  }, []);

  const toggleCollapse = useCallback(() => {
    setIsCollapsed((prev) => !prev);
  }, []);

  return (
    <TooltipProvider>
      <aside
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={cn(
          "h-screen flex flex-col bg-card border-r border-border overflow-hidden transition-all duration-200 ease-in-out shrink-0",
          isCollapsed ? "w-12" : "w-[220px]",
        )}
      >
        {/* Logo */}
        <div
          className={cn("flex items-center h-14 shrink-0", isCollapsed ? "justify-center" : "px-3")}
        >
          <span className="text-primary font-bold text-lg whitespace-nowrap">
            {isCollapsed ? "\u2B21" : "\u2B21 Gnana"}
          </span>
        </div>

        {/* Navigation */}
        <nav
          className={cn("flex-1 flex flex-col gap-1 py-2", isCollapsed ? "items-center" : "px-2")}
        >
          {navItems.map((item) => (
            <SidebarItem
              key={item.href}
              icon={item.icon}
              label={item.label}
              href={item.href}
              isCollapsed={isCollapsed}
            />
          ))}
        </nav>

        {/* Bottom section */}
        <div className={cn("shrink-0 pb-3", isCollapsed ? "px-1" : "px-2")}>
          <Separator className="mb-2" />
          <div className={cn("flex flex-col gap-1", isCollapsed ? "items-center" : "")}>
            <ThemeToggle isCollapsed={isCollapsed} />

            {/* Pin/Unpin button — visible when expanded */}
            {!isCollapsed && (
              <button
                onClick={togglePin}
                className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-accent-foreground"
                aria-label={isPinned ? "Unpin sidebar" : "Pin sidebar"}
              >
                {isPinned ? (
                  <PinOff className="h-4 w-4 shrink-0" />
                ) : (
                  <Pin className="h-4 w-4 shrink-0" />
                )}
                <span className="truncate">{isPinned ? "Unpin" : "Pin"}</span>
              </button>
            )}

            {/* Collapse/Expand button — visible when pinned */}
            {isPinned && (
              <button
                onClick={toggleCollapse}
                className={cn(
                  "flex items-center gap-3 rounded-md text-sm font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-accent-foreground",
                  isCollapsed ? "justify-center w-10 h-10" : "px-3 py-2",
                )}
                aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              >
                {isCollapsed ? (
                  <ChevronRight className="h-4 w-4 shrink-0" />
                ) : (
                  <ChevronLeft className="h-4 w-4 shrink-0" />
                )}
                {!isCollapsed && <span className="truncate">Collapse</span>}
              </button>
            )}
          </div>
        </div>
      </aside>
    </TooltipProvider>
  );
}
