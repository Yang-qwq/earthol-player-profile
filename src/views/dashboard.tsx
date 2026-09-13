/** Console workspace: profile sheet, key/value fields, and tags. */
import { Layout } from './layout';
import type { FieldRow, IdentityRow, TagCategoryRow, UserRow, UserTagRow } from '../db/types';
import { THEMES, VISIBILITIES } from '../lib/themes';
import { tagChipClasses } from '../lib/tags';
import type { Locale, MessageKey, TranslateFn } from '../i18n';

export interface DashboardProps {
  appName: string;
  faviconUrl: string;
  csrfToken: string;
  user: UserRow;
  gravatarUrl: string;
  fields: FieldRow[];
  tags: UserTagRow[];
  tagCategories: TagCategoryRow[];
  identities: IdentityRow[];
  githubEnabled: boolean;
  magicEnabled: boolean;
  error?: string;
  message?: string;
  nonce?: string;
  t: TranslateFn;
  locale: Locale;
  pathname: string;
  isAdmin?: boolean;
}

export function Dashboard({
  appName,
  faviconUrl,
  csrfToken,
  user,
  gravatarUrl,
  fields,
  tags,
  tagCategories,
  identities,
  githubEnabled,
  magicEnabled,
  error,
  message,
  nonce,
  t,
  locale,
  pathname,
  isAdmin,
}: DashboardProps) {
  const githubIdentity = identities.find((identity) => identity.provider === 'github');
  const emailIdentity = identities.find((identity) => identity.provider === 'email');

  return (
    <Layout
      appName={appName}
      faviconUrl={faviconUrl}
      title={t('dash.title')}
      shell="console"
      csrfToken={csrfToken}
      currentUser={{ username: user.username ?? '', displayName: user.display_name }}
      nonce={nonce}
      t={t}
      locale={locale}
      pathname={pathname}
      isAdmin={isAdmin}
    >
      <section class="space-y-6">
        {error ? (
          <p class="rounded-2xl bg-danger/10 px-5 py-4 text-sm text-danger ring-1 ring-inset ring-danger/25">
            {error}
          </p>
        ) : null}
        {message ? (
          <p class="rounded-2xl bg-success/10 px-5 py-4 text-sm text-success ring-1 ring-inset ring-success/25">
            {message}
          </p>
        ) : null}

        <form method="post" action="/dashboard/profile" class="card p-6">
          <input type="hidden" name="_csrf" value={csrfToken} />

          <div class="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 class="text-lg font-bold tracking-tight">{t('dash.sheetHeading')}</h2>
              <p class="mt-0.5 text-sm text-muted-foreground">
                {t('dash.publicUrl')}{' '}
                <a class="font-semibold text-primary hover:underline" href={`/${user.username}`}>
                  /{user.username}
                </a>
              </p>
            </div>
          </div>

          <div class="grid gap-4 sm:grid-cols-2">
            <Field label={t('dash.field.handle')} name="username" value={user.username ?? ''} required />
            <Field
              label={t('dash.field.displayName')}
              name="display_name"
              value={user.display_name ?? ''}
            />
            <Field label={t('dash.field.tagline')} name="headline" value={user.headline ?? ''} />
            <Field label={t('dash.field.location')} name="location" value={user.location ?? ''} />
            <Field label={t('dash.field.pronouns')} name="pronouns" value={user.pronouns ?? ''} />
            <Field label={t('dash.field.website')} name="website" value={user.website ?? ''} />
          </div>

          <div class="mt-4">
            <label class="label" for="avatar_url">
              {t('dash.field.avatar')}
            </label>
            <div class="flex items-center gap-2" data-gravatar>
              <input
                id="avatar_url"
                name="avatar_url"
                value={user.avatar_url ?? ''}
                class="field min-w-0 flex-1"
                data-avatar-input
              />
              {gravatarUrl ? (
                <button
                  type="button"
                  class="btn-outline shrink-0"
                  data-gravatar-url={gravatarUrl}
                  title={t('dash.gravatarHint')}
                >
                  <span class="material-symbols-outlined icon-sm" aria-hidden="true">
                    account_circle
                  </span>
                  {t('dash.useGravatar')}
                </button>
              ) : null}
            </div>
          </div>

          <div class="mt-4">
            <label class="label" for="bio">
              {t('dash.field.bio')}
            </label>
            <textarea
              id="bio"
              name="bio"
              rows={5}
              maxlength={1000}
              class="w-full rounded-2xl border border-border bg-muted px-4 py-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/70 focus:border-primary focus:bg-card focus:ring-2 focus:ring-ring/30"
            >
              {user.bio ?? ''}
            </textarea>
            <p class="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              {t('dash.field.bioHint')}
            </p>
          </div>

          <div class="mt-4 grid gap-4 sm:grid-cols-2">
            <Select
              label={t('dash.field.theme')}
              name="theme"
              value={user.theme}
              options={THEMES.map((theme) => ({
                value: theme.id,
                label: t(`theme.${theme.id}` as MessageKey),
              }))}
            />
            <Select
              label={t('dash.field.visibility')}
              name="visibility"
              value={user.visibility}
              options={VISIBILITIES.map((value) => ({ value, label: t(`visibility.${value}`) }))}
            />
          </div>

          <div class="mt-6 flex items-center justify-end gap-3">
            <a href={`/${user.username}`} class="btn-outline">
              {t('dash.viewProfile')}
            </a>
            <button type="submit" class="btn-primary">
              {t('dash.saveProfile')}
            </button>
          </div>
        </form>

        <section class="card p-6">
          <div class="mb-5">
            <h2 class="text-lg font-bold tracking-tight">{t('dash.accountsHeading')}</h2>
            <p class="mt-0.5 text-sm text-muted-foreground">{t('dash.accountsSubtitle')}</p>
          </div>

          <div class="space-y-3">
            <div class="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-muted px-4 py-3">
              <div class="flex min-w-0 items-center gap-3">
                <span class="material-symbols-outlined text-muted-foreground" aria-hidden="true">
                  code
                </span>
                <div class="min-w-0">
                  <p class="text-sm font-semibold">{t('dash.account.github')}</p>
                  <p class="truncate text-xs text-muted-foreground">
                    {githubIdentity
                      ? githubIdentity.email ?? t('dash.account.connected')
                      : t('dash.account.notConnected')}
                  </p>
                </div>
              </div>
              {githubIdentity ? (
                <span class="rounded-full bg-success/10 px-3 py-1 text-xs font-semibold text-success ring-1 ring-inset ring-success/25">
                  {t('dash.account.connected')}
                </span>
              ) : githubEnabled ? (
                <a href="/auth/github/link" class="btn-outline shrink-0">
                  <span class="material-symbols-outlined icon-sm" aria-hidden="true">
                    link
                  </span>
                  {t('dash.account.connectGithub')}
                </a>
              ) : (
                <span class="text-xs text-muted-foreground">{t('dash.account.notConfigured')}</span>
              )}
            </div>

            <div class="rounded-2xl bg-muted px-4 py-3">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <div class="flex min-w-0 items-center gap-3">
                  <span class="material-symbols-outlined text-muted-foreground" aria-hidden="true">
                    mail
                  </span>
                  <div class="min-w-0">
                    <p class="text-sm font-semibold">{t('dash.account.email')}</p>
                    <p class="truncate text-xs text-muted-foreground">
                      {emailIdentity
                        ? emailIdentity.provider_user_id
                        : t('dash.account.notConnected')}
                    </p>
                  </div>
                </div>
                {emailIdentity ? (
                  <span class="rounded-full bg-success/10 px-3 py-1 text-xs font-semibold text-success ring-1 ring-inset ring-success/25">
                    {t('dash.account.connected')}
                  </span>
                ) : null}
              </div>

              {!emailIdentity && magicEnabled ? (
                <form
                  method="post"
                  action="/dashboard/identities/email"
                  class="mt-3 flex flex-col gap-2 sm:flex-row"
                >
                  <input type="hidden" name="_csrf" value={csrfToken} />
                  <input
                    type="email"
                    name="email"
                    required
                    autocomplete="email"
                    placeholder="you@example.com"
                    class="field min-w-0 flex-1"
                  />
                  <button type="submit" class="btn-outline shrink-0">
                    <span class="material-symbols-outlined icon-sm" aria-hidden="true">
                      forward_to_inbox
                    </span>
                    {t('dash.account.connectEmail')}
                  </button>
                </form>
              ) : null}

              {!emailIdentity && !magicEnabled ? (
                <p class="mt-2 text-xs text-muted-foreground">{t('dash.account.notConfigured')}</p>
              ) : null}
            </div>
          </div>
        </section>

        <form method="post" action="/dashboard/fields" class="card p-6" data-repeater>
          <input type="hidden" name="_csrf" value={csrfToken} />

          <div class="mb-5">
            <h2 class="text-lg font-bold tracking-tight">{t('dash.fieldsHeading')}</h2>
            <p class="mt-0.5 text-sm text-muted-foreground">{t('dash.fieldsSubtitle')}</p>
          </div>

          <div data-repeater-list>
            {fields.map((field) => (
              <div class="mb-2 flex flex-col gap-2 sm:flex-row" data-repeater-row>
                <input
                  name="label"
                  value={field.label}
                  placeholder={t('dash.fieldLabelPlaceholder')}
                  maxlength={40}
                  class="field sm:w-1/3"
                />
                <input
                  name="value"
                  value={field.value}
                  placeholder={t('dash.fieldValuePlaceholder')}
                  maxlength={300}
                  class="field"
                />
                <button
                  type="button"
                  data-repeater-remove
                  class="btn-outline shrink-0 border-danger/30 px-4 text-danger hover:bg-danger/10"
                >
                  {t('dash.remove')}
                </button>
              </div>
            ))}
          </div>

          <p
            data-repeater-empty
            class={`rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground ${fields.length ? 'hidden' : ''}`}
          >
            {t('dash.noFields')}
          </p>

          <template data-repeater-template>
            <div class="mb-2 flex flex-col gap-2 sm:flex-row" data-repeater-row>
              <input
                name="label"
                placeholder={t('dash.fieldLabelPlaceholder')}
                maxlength={40}
                class="field sm:w-1/3"
              />
              <input
                name="value"
                placeholder={t('dash.fieldValuePlaceholder')}
                maxlength={300}
                class="field"
              />
              <button
                type="button"
                data-repeater-remove
                class="btn-outline shrink-0 border-danger/30 px-4 text-danger hover:bg-danger/10"
              >
                {t('dash.remove')}
              </button>
            </div>
          </template>

          <div class="mt-5 flex flex-wrap gap-3">
            <button type="button" data-repeater-add class="btn-outline">
              <span class="material-symbols-outlined icon-sm" aria-hidden="true">
                add
              </span>
              {t('dash.addField')}
            </button>
            <button type="submit" class="btn-primary">
              {t('dash.saveFields')}
            </button>
          </div>
        </form>

        <form method="post" action="/dashboard/tags" class="card p-6" data-repeater>
          <input type="hidden" name="_csrf" value={csrfToken} />

          <div class="mb-5">
            <h2 class="text-lg font-bold tracking-tight">{t('dash.tagsHeading')}</h2>
            <p class="mt-0.5 text-sm text-muted-foreground">{t('dash.tagsSubtitle')}</p>
          </div>

          {tags.length > 0 ? (
            <div class="mb-4 flex flex-wrap gap-2">
              {tags.map((tag) => (
                <span key={tag.id} class={`chip ${tagChipClasses(tag.category_color)}`}>
                  <span class="text-[10px] font-bold uppercase tracking-wider opacity-70">
                    {tag.category_name}
                  </span>
                  <span>{tag.value}</span>
                </span>
              ))}
            </div>
          ) : null}

          {tagCategories.length === 0 ? (
            <p class="rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">
              {t('dash.noTagCategories')}
            </p>
          ) : (
            <>
              <div data-repeater-list>
                {tags.map((tag) => (
                  <div class="mb-2 flex flex-col gap-2 sm:flex-row" data-repeater-row>
                    <div class="relative sm:w-1/2">
                      <input
                        name="tag"
                        value={tag.value}
                        placeholder={t('dash.tagPlaceholder')}
                        maxlength={40}
                        autocomplete="off"
                        data-tag-input
                        class="field w-full"
                      />
                    </div>
                    <select name="category_id" data-tag-category class="field sm:w-1/3">
                      {tagCategories.map((category) => (
                        <option value={category.id} selected={category.id === tag.category_id}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                    <TagHiddenToggle hidden={Boolean(tag.hidden)} label={t('dash.tagHidden')} />
                    <button
                      type="button"
                      data-repeater-remove
                      class="btn-outline shrink-0 border-danger/30 px-4 text-danger hover:bg-danger/10"
                    >
                      {t('dash.remove')}
                    </button>
                  </div>
                ))}
              </div>

              <p
                data-repeater-empty
                class={`rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground ${tags.length ? 'hidden' : ''}`}
              >
                {t('dash.noTags')}
              </p>

              <template data-repeater-template>
                <div class="mb-2 flex flex-col gap-2 sm:flex-row" data-repeater-row>
                  <div class="relative sm:w-1/2">
                    <input
                      name="tag"
                      placeholder={t('dash.tagPlaceholder')}
                      maxlength={40}
                      autocomplete="off"
                      data-tag-input
                      class="field w-full"
                    />
                  </div>
                  <select name="category_id" data-tag-category class="field sm:w-1/3">
                    {tagCategories.map((category, index) => (
                      <option value={category.id} selected={index === 0}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                  <TagHiddenToggle hidden={false} label={t('dash.tagHidden')} />
                  <button
                    type="button"
                    data-repeater-remove
                    class="btn-outline shrink-0 border-danger/30 px-4 text-danger hover:bg-danger/10"
                  >
                    {t('dash.remove')}
                  </button>
                </div>
              </template>

              <div class="mt-5 flex flex-wrap gap-3">
                <button type="button" data-repeater-add class="btn-outline">
                  <span class="material-symbols-outlined icon-sm" aria-hidden="true">
                    add
                  </span>
                  {t('dash.addTag')}
                </button>
                <button type="submit" class="btn-primary">
                  {t('dash.saveTags')}
                </button>
              </div>
            </>
          )}
        </form>
      </section>
    </Layout>
  );
}

function TagHiddenToggle({ hidden, label }: { hidden: boolean; label: string }) {
  return (
    <>
      <input type="hidden" name="hidden" value={hidden ? '1' : '0'} data-tag-hidden-input />
      <button
        type="button"
        data-tag-hidden-toggle
        aria-pressed={hidden ? 'true' : 'false'}
        aria-label={label}
        title={label}
        class="btn-icon shrink-0 aria-pressed:bg-primary/10 aria-pressed:text-primary"
      >
        <span class="material-symbols-outlined tag-hidden-visible" aria-hidden="true">
          visibility
        </span>
        <span class="material-symbols-outlined tag-hidden-off" aria-hidden="true">
          visibility_off
        </span>
      </button>
    </>
  );
}

function Field(props: { label: string; name: string; value: string; required?: boolean }) {
  return (
    <div>
      <label class="label" for={props.name}>
        {props.label}
      </label>
      <input id={props.name} name={props.name} value={props.value} required={props.required} class="field" />
    </div>
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
