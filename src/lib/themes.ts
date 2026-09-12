/**
 * Profile theme and visibility vocabulary. `THEMES` drives the dashboard/admin
 * pickers; `THEME_STYLES` maps ids to literal Tailwind classes (kept in source
 * so the v4 scanner includes them in the build).
 */
export interface ThemeOption {
  id: string;
  label: string;
}

export const THEMES: ThemeOption[] = [
  { id: 'default', label: 'Midnight' },
  { id: 'neon', label: 'Neon Arcade' },
  { id: 'sunset', label: 'Sunset Run' },
  { id: 'forest', label: 'Deep Forest' },
  { id: 'mono', label: 'Monochrome' },
];

export const VISIBILITIES = ['public', 'unlisted', 'private'] as const;

export interface ThemeStyle {
  accent: string;
  ring: string;
}

export const THEME_STYLES: Record<string, ThemeStyle> = {
  default: {
    accent: 'from-indigo-500 to-fuchsia-500',
    ring: 'ring-indigo-500/40',
  },
  neon: {
    accent: 'from-cyan-400 to-lime-400',
    ring: 'ring-cyan-400/40',
  },
  sunset: {
    accent: 'from-amber-400 to-rose-500',
    ring: 'ring-amber-400/40',
  },
  forest: {
    accent: 'from-emerald-400 to-teal-500',
    ring: 'ring-emerald-400/40',
  },
  mono: {
    accent: 'from-slate-300 to-slate-500',
    ring: 'ring-slate-400/40',
  },
};

export function themeStyle(theme: string): ThemeStyle {
  return THEME_STYLES[theme] ?? THEME_STYLES.default;
}

export function isTheme(value: string): boolean {
  return THEMES.some((theme) => theme.id === value);
}

export function isVisibility(value: string): boolean {
  return (VISIBILITIES as readonly string[]).includes(value);
}
