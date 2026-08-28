// Each option colour needs an explicit dark variant: the light tints are
// unreadable on a dark surface.
export const OPTION_COLORS: Record<string, string> = {
  gray: "bg-neutral-200 text-neutral-800 dark:bg-neutral-700 dark:text-neutral-100",
  blue: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  green: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
  red: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  purple: "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-200",
  yellow: "bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200",
  orange: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200",
  pink: "bg-pink-100 text-pink-800 dark:bg-pink-950 dark:text-pink-200",
};

export function optionColorClass(color: string | undefined): string {
  return OPTION_COLORS[color ?? "gray"] ?? OPTION_COLORS.gray;
}

export const COLOR_NAMES = Object.keys(OPTION_COLORS);
