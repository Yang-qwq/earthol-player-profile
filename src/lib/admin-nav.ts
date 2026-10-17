/**
 * Admin sub-module registry — the single source of truth for the sidebar's
 * second-level admin menu, the overview page's quick links, and the section
 * routes. Every entry gets its own `GET /admin/...` page (see
 * `src/routes/admin.tsx`); form posts redirect back to the same page.
 */
import type { MessageKey } from '../i18n';

export type AdminSection =
  | 'overview'
  | 'settings'
  | 'integrations'
  | 'ai'
  | 'code'
  | 'landing'
  | 'reserved'
  | 'tags'
  | 'users'
  | 'moderation';

/** URL of each section's page. */
export const ADMIN_SECTION_PATH: Record<AdminSection, string> = {
  overview: '/admin',
  settings: '/admin/settings',
  integrations: '/admin/integrations',
  ai: '/admin/ai',
  code: '/admin/custom-code',
  landing: '/admin/landing',
  reserved: '/admin/reserved',
  tags: '/admin/tags',
  users: '/admin/users',
  moderation: '/admin/moderation',
};

/** Sidebar / overview entries in display order. */
export const ADMIN_SECTIONS: readonly {
  section: AdminSection;
  path: string;
  key: MessageKey;
  icon: string;
}[] = [
  { section: 'overview', path: '/admin', key: 'admin.nav.overview', icon: 'space_dashboard' },
  { section: 'settings', path: '/admin/settings', key: 'admin.nav.settings', icon: 'tune' },
  { section: 'integrations', path: '/admin/integrations', key: 'admin.nav.integrations', icon: 'extension' },
  { section: 'ai', path: '/admin/ai', key: 'admin.nav.ai', icon: 'smart_toy' },
  { section: 'code', path: '/admin/custom-code', key: 'admin.nav.code', icon: 'code_blocks' },
  { section: 'landing', path: '/admin/landing', key: 'admin.nav.landing', icon: 'web' },
  { section: 'reserved', path: '/admin/reserved', key: 'admin.nav.reserved', icon: 'block' },
  { section: 'tags', path: '/admin/tags', key: 'admin.nav.tags', icon: 'sell' },
  { section: 'users', path: '/admin/users', key: 'admin.nav.users', icon: 'group' },
  { section: 'moderation', path: '/admin/moderation', key: 'admin.nav.moderation', icon: 'gavel' },
];
