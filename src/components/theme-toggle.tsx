"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import type { ThemePreference } from "@/lib/theme";
import { cn } from "@/lib/utils";

const OPTIONS: { value: ThemePreference; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
];

/** Three-way theme switch: light, dark, follow the OS. */
export function ThemeToggle() {
  const { preference, setPreference } = useTheme();

  return (
    <div
      data-testid="theme-toggle"
      role="radiogroup"
      aria-label="Theme"
      className="flex items-center gap-0.5 rounded-md border p-0.5"
    >
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={preference === value}
          aria-label={label}
          title={label}
          onClick={() => setPreference(value)}
          className={cn(
            "flex h-6 flex-1 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground",
            preference === value && "bg-accent text-foreground",
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </button>
      ))}
    </div>
  );
}
