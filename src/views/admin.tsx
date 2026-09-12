/** Presentational view for the admin panel; all writes are posted to `/admin/*`. */
import { Layout } from './layout';
import type { TagCategoryRow, UserRow } from '../db/types';
import { TAG_COLORS, tagChipClasses } from '../lib/tags';
import { THEMES, VISIBILITIES } from '../lib/themes';
import type { AdminStats } from '../db/queries';
import type { SiteSettings } from '../lib/settings';
import type { Locale, MessageKey, TranslateFn } from '../i18n';

export interface AdminViewProps {
  appName: string;
  csrfToken: string;
  t: TranslateFn;
  locale: Locale;
  pathname: string;
  currentUser: { username: string; displayName?: string | null } | null;
  selfId: string;
  envAdminEmails: string[];
  settings: SiteSettings;
  stats: AdminStats;
  reserved: string[];
  tagCategories: TagCategoryRow[];
  users: UserRow[];
  query: string;
  message?: string;
  error?: string;
  nonce?: string;
}

function formatDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export function AdminView({
  appName,
  csrfToken,
  t,
  locale,
  pathname,
  currentUser,
  selfId,
  envAdminEmails,
  settings,
  stats,
  reserved,
  tagCategories,
  users,
  query,
  message,
  error,
  nonce,
}: AdminViewProps) {
  const envSet = new Set(envAdminEmails.map((email) => email.toLowerCase()));
  const statsCards = [
    { label: t('admin.stats.users'), value: stats.users },
    { label: t('admin.stats.handles'), value: stats.handles },
    { label: t('admin.stats.fields'), value: stats.fields },
    { label: t('admin.stats.admins'), value: stats.admins },
  ];

  return (
    <Layout
      appName={appName}
      faviconUrl={settings.faviconUrl}
      title={t('admin.title')}
      shell="console"
      csrfToken={csrfToken}
      currentUser={currentUser}
      nonce={nonce}
      t={t}
      locale={locale}
      pathname={pathname}
      isAdmin
    >
      <section class="space-y-6">
        <div>
          <h1 class="text-xl font-bold tracking-tight">{t('admin.heading')}</h1>
          <p class="mt-0.5 text-sm text-muted-foreground">{t('admin.subtitle')}</p>
        </div>

        {message ? (
          <p class="rounded-2xl bg-success/10 px-5 py-4 text-sm text-success ring-1 ring-inset ring-success/25">
            {message}
          </p>
        ) : null}
        {error ? (
          <p class="rounded-2xl bg-danger/10 px-5 py-4 text-sm text-danger ring-1 ring-inset ring-danger/25">
            {error}
          </p>
        ) : null}

        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {statsCards.map((card) => (
            <div key={card.label} class="card p-4">
              <p class="text-2xl font-bold tabular-nums">{card.value}</p>
              <p class="mt-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {card.label}
              </p>
            </div>
          ))}
        </div>

        <form method="post" action="/admin/settings" class="card p-6">
          <input type="hidden" name="_csrf" value={csrfToken} />
          <div class="mb-5">
            <h2 class="text-lg font-bold tracking-tight">{t('admin.settings.heading')}</h2>
            <p class="mt-0.5 text-sm text-muted-foreground">{t('admin.settings.subtitle')}</p>
          </div>

          <div class="grid gap-4 sm:grid-cols-2">
            <div>
              <label class="label" for="site_name">
                {t('admin.settings.siteName')}
              </label>
              <input
                id="site_name"
                name="site_name"
                value={settings.siteName}
                maxlength={60}
                class="field"
              />
              <p class="mt-1 px-1 text-xs text-muted-foreground">{t('admin.settings.siteNameHint')}</p>
            </div>
            <div>
              <label class="label" for="favicon_url">
                {t('admin.settings.favicon')}
              </label>
              <input
                id="favicon_url"
                name="favicon_url"
                value={settings.faviconUrl}
                maxlength={500}
                placeholder="https://example.com/favicon.ico"
                class="field"
              />
              <p class="mt-1 px-1 text-xs text-muted-foreground">
                {t('admin.settings.faviconHint')}
              </p>
            </div>
          </div>

          <div class="mt-4 grid gap-3 sm:grid-cols-2">
            <Toggle
              name="signups_enabled"
              label={t('admin.settings.signups')}
              checked={settings.signupsEnabled}
            />
            <Toggle
              name="maintenance_mode"
              label={t('admin.settings.maintenance')}
              checked={settings.maintenanceMode}
            />
            <Toggle
              name="github_login_enabled"
              label={t('admin.settings.github')}
              checked={settings.githubLoginEnabled}
            />
            <Toggle
              name="magic_link_enabled"
              label={t('admin.settings.magic')}
              checked={settings.magicLinkEnabled}
            />
          </div>

          <div class="mt-4 grid gap-4 sm:grid-cols-2">
            <Select
              label={t('admin.settings.defaultTheme')}
              name="default_theme"
              value={settings.defaultTheme}
              options={THEMES.map((theme) => ({
                value: theme.id,
                label: t(`theme.${theme.id}` as MessageKey),
              }))}
            />
            <Select
              label={t('admin.settings.defaultVisibility')}
              name="default_visibility"
              value={settings.defaultVisibility}
              options={VISIBILITIES.map((value) => ({ value, label: t(`visibility.${value}`) }))}
            />
          </div>

          <div class="mt-6 flex justify-end">
            <button type="submit" class="btn-primary">
              {t('admin.settings.save')}
            </button>
          </div>
        </form>

        <div class="card p-6">
          <div class="mb-5">
            <h2 class="text-lg font-bold tracking-tight">{t('admin.reserved.heading')}</h2>
            <p class="mt-0.5 text-sm text-muted-foreground">{t('admin.reserved.subtitle')}</p>
          </div>

          <form method="post" action="/admin/reserved/add" class="flex flex-wrap gap-2">
            <input type="hidden" name="_csrf" value={csrfToken} />
            <input
              name="name"
              required
              maxlength={40}
              placeholder={t('admin.reserved.placeholder')}
              class="field sm:w-64"
            />
            <button type="submit" class="btn-primary">
              {t('admin.reserved.add')}
            </button>
          </form>

          <div class="mt-4 flex flex-wrap gap-2">
            {reserved.map((name) => (
              <form
                key={name}
                method="post"
                action="/admin/reserved/remove"
                class="inline-flex items-center gap-1 rounded-full border border-border bg-muted py-0.5 pl-3 pr-1 text-sm"
              >
                <input type="hidden" name="_csrf" value={csrfToken} />
                <input type="hidden" name="name" value={name} />
                <span class="font-mono text-xs">{name}</span>
                <button
                  type="submit"
                  aria-label={`${t('admin.reserved.remove')} ${name}`}
                  class="btn-icon h-6 w-6 text-muted-foreground hover:text-danger"
                >
                  <span class="material-symbols-outlined icon-xs" aria-hidden="true">
                    close
                  </span>
                </button>
              </form>
            ))}
          </div>
        </div>

        <div class="card p-6">
          <div class="mb-5">
            <h2 class="text-lg font-bold tracking-tight">{t('admin.tags.heading')}</h2>
            <p class="mt-0.5 text-sm text-muted-foreground">{t('admin.tags.subtitle')}</p>
          </div>

          <form method="post" action="/admin/tags/add" class="flex flex-wrap items-end gap-2">
            <input type="hidden" name="_csrf" value={csrfToken} />
            <div class="min-w-48 flex-1">
              <label class="label" for="tag_category_name">
                {t('admin.tags.name')}
              </label>
              <input
                id="tag_category_name"
                name="name"
                required
                maxlength={40}
                placeholder={t('admin.tags.namePlaceholder')}
                class="field"
              />
            </div>
            <div class="w-full sm:w-44">
              <Select
                label={t('admin.tags.color')}
                name="color"
                value="sky"
                options={TAG_COLORS.map((color) => ({
                  value: color.id,
                  label: t(`tagColor.${color.id}` as MessageKey),
                }))}
              />
            </div>
            <button type="submit" class="btn-primary">
              {t('admin.tags.add')}
            </button>
          </form>

          {tagCategories.length === 0 ? (
            <p class="mt-4 rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">
              {t('admin.tags.empty')}
            </p>
          ) : (
            <>
              <div class="mt-5 space-y-2">
                {tagCategories.map((category) => (
                  <div key={category.id} class="flex flex-wrap items-center gap-2">
                    <form method="post" action="/admin/tags/update" class="contents">
                      <input type="hidden" name="_csrf" value={csrfToken} />
                      <input type="hidden" name="id" value={category.id} />
                      <span class={`chip shrink-0 ${tagChipClasses(category.color)}`}>
                        {category.name}
                      </span>
                      <input
                        name="name"
                        value={category.name}
                        required
                        maxlength={40}
                        aria-label={t('admin.tags.name')}
                        class="field min-w-40 flex-1 sm:max-w-56"
                      />
                      <select
                        name="color"
                        aria-label={t('admin.tags.color')}
                        class="field w-36 appearance-none pr-8"
                      >
                        {TAG_COLORS.map((color) => (
                          <option value={color.id} selected={color.id === category.color}>
                            {t(`tagColor.${color.id}` as MessageKey)}
                          </option>
                        ))}
                      </select>
                      <button type="submit" class="btn-outline px-3 py-1 text-xs">
                        {t('admin.tags.save')}
                      </button>
                    </form>
                    <form method="post" action="/admin/tags/remove" class="contents">
                      <input type="hidden" name="_csrf" value={csrfToken} />
                      <input type="hidden" name="id" value={category.id} />
                      <button
                        type="submit"
                        class="btn-outline px-3 py-1 text-xs border-danger/30 text-danger hover:bg-danger/10"
                      >
                        {t('admin.tags.remove')}
                      </button>
                    </form>
                  </div>
                ))}
              </div>
              <p class="mt-3 px-1 text-xs text-muted-foreground">{t('admin.tags.deleteHint')}</p>
            </>
          )}
        </div>

        <div class="card p-6">
          <div class="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 class="text-lg font-bold tracking-tight">{t('admin.users.heading')}</h2>
              <p class="mt-0.5 text-sm text-muted-foreground">{t('admin.users.subtitle')}</p>
            </div>
            <form method="get" action="/admin" class="flex gap-2">
              <input
                name="q"
                value={query}
                placeholder={t('admin.users.search')}
                class="field sm:w-56"
              />
              <button type="submit" class="btn-outline">
                {t('admin.users.search')}
              </button>
            </form>
          </div>

          {users.length === 0 ? (
            <p class="rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">
              {t('admin.users.none')}
            </p>
          ) : (
            <div class="overflow-x-auto">
              <table class="w-full text-left text-sm">
                <thead class="text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th class="py-2 pr-4 font-semibold">{t('admin.users.col.user')}</th>
                    <th class="py-2 pr-4 font-semibold">{t('admin.users.col.email')}</th>
                    <th class="py-2 pr-4 font-semibold">{t('admin.users.col.joined')}</th>
                    <th class="py-2 pr-4 font-semibold">{t('admin.users.col.actions')}</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-border">
                  {users.map((row) => {
                    const isSelf = row.id === selfId;
                    const isEnv = row.email ? envSet.has(row.email.toLowerCase()) : false;
                    const isAdmin = row.is_admin === 1 || isEnv;
                    return (
                      <tr key={row.id}>
                        <td class="py-2.5 pr-4">
                          <div class="flex items-center gap-2">
                            <span class="font-semibold">
                              {row.display_name || row.username || '—'}
                            </span>
                            {isSelf ? (
                              <span class="chip bg-primary/10 text-primary">
                                {t('admin.users.you')}
                              </span>
                            ) : null}
                            {isAdmin ? (
                              <span class="chip bg-secondary/15 text-secondary">
                                {isEnv ? t('admin.users.envAdmin') : t('admin.title')}
                              </span>
                            ) : null}
                          </div>
                          {row.username ? (
                            <a
                              href={`/${row.username}`}
                              class="text-xs text-muted-foreground hover:text-primary hover:underline"
                            >
                              @{row.username}
                            </a>
                          ) : (
                            <span class="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td class="py-2.5 pr-4 text-muted-foreground">{row.email ?? '—'}</td>
                        <td class="py-2.5 pr-4 text-muted-foreground tabular-nums">
                          {formatDate(row.created_at)}
                        </td>
                        <td class="py-2.5 pr-4">
                          {isSelf ? (
                            <span class="text-xs text-muted-foreground">—</span>
                          ) : (
                            <div class="flex flex-wrap items-center gap-2">
                              {row.username ? (
                                <a href={`/${row.username}`} class="btn-ghost px-3 py-1 text-xs">
                                  {t('admin.users.view')}
                                </a>
                              ) : null}
                              {!isEnv ? (
                                <form
                                  method="post"
                                  action={`/admin/users/${row.id}/admin`}
                                  class="contents"
                                >
                                  <input type="hidden" name="_csrf" value={csrfToken} />
                                  <button type="submit" class="btn-outline px-3 py-1 text-xs">
                                    {isAdmin
                                      ? t('admin.users.revokeAdmin')
                                      : t('admin.users.grantAdmin')}
                                  </button>
                                </form>
                              ) : null}
                              <form
                                method="post"
                                action={`/admin/users/${row.id}/delete`}
                                class="contents"
                              >
                                <input type="hidden" name="_csrf" value={csrfToken} />
                                <button
                                  type="submit"
                                  class="btn-outline px-3 py-1 text-xs border-danger/30 text-danger hover:bg-danger/10"
                                >
                                  {t('admin.users.delete')}
                                </button>
                              </form>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </Layout>
  );
}

function Toggle(props: { name: string; label: string; checked: boolean }) {
  return (
    <label class="flex cursor-pointer items-center gap-3 rounded-2xl border border-border bg-muted px-4 py-3 text-sm font-medium">
      <input
        type="checkbox"
        name={props.name}
        value="1"
        checked={props.checked}
        class="h-4 w-4 accent-[hsl(var(--primary))]"
      />
      <span>{props.label}</span>
    </label>
  );
}

function Select(props: {
  label: string;
  name: string;
  value: string;
  options: { value: string; label: string }[];
}) {
  return (
    <div>
      <label class="label" for={props.name}>
        {props.label}
      </label>
      <select id={props.name} name={props.name} class="field appearance-none pr-10">
        {props.options.map((option) => (
          <option value={option.value} selected={option.value === props.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
