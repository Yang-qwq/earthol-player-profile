/**
 * Fixed palette for tag categories. Admins pick one of these ids when creating
 * or editing a category; the stored value is always validated against `TAG_COLORS`
 * so arbitrary class names can never reach the profile markup. The full class
 * strings live here literally so Tailwind's source scan keeps them in the build.
 */
export interface TagColor {
  id: string;
  /** Classes applied to the tag chip on the profile page. */
  chip: string;
  /** Swatch classes for the admin picker. */
  swatch: string;
}

export const TAG_COLORS: TagColor[] = [
  {
    id: 'sky',
    chip: 'bg-sky-500/12 text-sky-600 ring-1 ring-inset ring-sky-500/25 dark:text-sky-300',
    swatch: 'bg-sky-500',
  },
  {
    id: 'violet',
    chip: 'bg-violet-500/12 text-violet-600 ring-1 ring-inset ring-violet-500/25 dark:text-violet-300',
    swatch: 'bg-violet-500',
  },
  {
    id: 'emerald',
    chip: 'bg-emerald-500/12 text-emerald-600 ring-1 ring-inset ring-emerald-500/25 dark:text-emerald-300',
    swatch: 'bg-emerald-500',
  },
  {
    id: 'amber',
    chip: 'bg-amber-500/12 text-amber-600 ring-1 ring-inset ring-amber-500/25 dark:text-amber-300',
    swatch: 'bg-amber-500',
  },
  {
    id: 'rose',
    chip: 'bg-rose-500/12 text-rose-600 ring-1 ring-inset ring-rose-500/25 dark:text-rose-300',
    swatch: 'bg-rose-500',
  },
  {
    id: 'cyan',
    chip: 'bg-cyan-500/12 text-cyan-600 ring-1 ring-inset ring-cyan-500/25 dark:text-cyan-300',
    swatch: 'bg-cyan-500',
  },
  {
    id: 'fuchsia',
    chip: 'bg-fuchsia-500/12 text-fuchsia-600 ring-1 ring-inset ring-fuchsia-500/25 dark:text-fuchsia-300',
    swatch: 'bg-fuchsia-500',
  },
  {
    id: 'orange',
    chip: 'bg-orange-500/12 text-orange-600 ring-1 ring-inset ring-orange-500/25 dark:text-orange-300',
    swatch: 'bg-orange-500',
  },
  {
    id: 'teal',
    chip: 'bg-teal-500/12 text-teal-600 ring-1 ring-inset ring-teal-500/25 dark:text-teal-300',
    swatch: 'bg-teal-500',
  },
  {
    id: 'slate',
    chip: 'bg-slate-500/12 text-slate-600 ring-1 ring-inset ring-slate-500/25 dark:text-slate-300',
    swatch: 'bg-slate-500',
  },
];

const COLOR_BY_ID: Record<string, TagColor> = Object.fromEntries(
  TAG_COLORS.map((color) => [color.id, color]),
);

export const DEFAULT_TAG_COLOR = 'sky';

export function isTagColor(value: string): boolean {
  return value in COLOR_BY_ID;
}

/** Chip classes for a stored color id, falling back to the default color. */
export function tagChipClasses(colorId: string): string {
  return (COLOR_BY_ID[colorId] ?? COLOR_BY_ID[DEFAULT_TAG_COLOR]).chip;
}

/** Swatch classes for a stored color id, falling back to the default color. */
export function tagSwatchClasses(colorId: string): string {
  return (COLOR_BY_ID[colorId] ?? COLOR_BY_ID[DEFAULT_TAG_COLOR]).swatch;
}
