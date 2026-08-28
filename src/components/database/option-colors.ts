export const OPTION_COLORS: Record<string, string> = {
  gray: "bg-neutral-200 text-neutral-800 dark:bg-neutral-700 dark:text-neutral-100",
  blue: "bg-blue-100 text-blue-800",
  green: "bg-green-100 text-green-800",
  red: "bg-red-100 text-red-800",
  purple: "bg-purple-100 text-purple-800",
  yellow: "bg-yellow-100 text-yellow-800",
  orange: "bg-orange-100 text-orange-800",
  pink: "bg-pink-100 text-pink-800",
};

export function optionColorClass(color: string | undefined): string {
  return OPTION_COLORS[color ?? "gray"] ?? OPTION_COLORS.gray;
}

export const COLOR_NAMES = Object.keys(OPTION_COLORS);
