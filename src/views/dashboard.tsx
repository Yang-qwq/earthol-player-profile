/** Console workspace: profile sheet, key/value fields, and tags. */
import type { Child } from 'hono/jsx';
import { Layout } from './layout';
import type {
  BlockRelation,
  BlockViewerRow,
  FieldRow,
  IdentityRow,
  ProfileBlockRow,
  TagCategoryRow,
  TotpFactorRow,
  UserRow,
  UserTagRow,
} from '../db/types';
import { THEMES, VISIBILITIES } from '../lib/themes';
import { tagChipClasses } from '../lib/tags';
import { MAX_AVATAR_BYTES } from '../lib/storage';
import { BLOCK_LIMITS } from '../db/queries';
import {
  isBlockVisibility,
  parseStoredList,
  relationOf,
  RELATIONS,
  tagMatchOf,
} from '../lib/audience';
import type { BlockVisibility } from '../db/types';
import { audienceOptions, blockKindLabel, parseGalleryItems } from '../lib/blocks';
import { DASHBOARD_SECTIONS, type DashboardSection } from '../lib/dashboard-nav';
import type { Locale, MessageKey, TranslateFn } from '../i18n';

/**
 * Renders the otpauth:// provisioning URI as a QR code for a pending TOTP
 * factor. Lazy-loads `qrcode-generator` from unpkg (already allowed by the
 * CSP `scriptSrc`) only when such a factor exists on the page.
 */
const TOTP_QR_SCRIPT = (s: Record<string, string>) =>
  `(function(){var S=${JSON.stringify(s)};function ensureQrcode(box,cb,err){if(typeof qrcode==='function'){cb();return;}var existing=document.querySelector('script[data-totp-qr-lib]');if(existing){existing.addEventListener('load',cb);existing.addEventListener('error',err);return;}var tag=document.createElement('script');tag.src='https://unpkg.com/qrcode-generator@1.4.4/qrcode.js';tag.setAttribute('data-totp-qr-lib','');tag.addEventListener('load',cb);tag.addEventListener('error',err);document.head.appendChild(tag);}function render(){var box=document.querySelector('[data-totp-qr]');if(!box||box.getAttribute('data-totp-rendered'))return;var uri=box.getAttribute('data-totp-uri')||'';if(!uri)return;box.setAttribute('data-totp-rendered','');ensureQrcode(box,function(){try{var q=qrcode(0,'M');q.addData(uri);q.make();box.innerHTML=q.createSvgTag({cellSize:5,margin:2,scalable:true});}catch(e){box.textContent=S.qrFailed;}},function(){box.textContent=S.qrFailed;});}render();document.addEventListener('htmx:afterSwap',render);})();`;

export interface DashboardProps {
  appName: string;
  faviconUrl: string;
  logoUrl: string;
  customCss?: string;
  customJs?: string;
  customFooter?: string;
  csrfToken: string;
  user: UserRow;
  /** Which sub-module page to render (drives the sidebar's second level). */
  section: DashboardSection;
  gravatarUrl: string;
  /** R2 avatar uploads are only offered when the bucket binding exists. */
  uploadEnabled: boolean;
  fields: FieldRow[];
  tags: UserTagRow[];
  tagCategories: TagCategoryRow[];
  /** Saved profile blocks for the Blocks editor (`blocks` section only). */
  blocks?: ProfileBlockRow[];
  /** Per-block allow/deny rows, for the Blocks editor's username fields. */
  blockViewers?: BlockViewerRow[];
  /** Where the non-removable key/value row sits in the Blocks editor. */
  fieldsPosition?: number;
  identities: IdentityRow[];
  githubEnabled: boolean;
  magicEnabled: boolean;
  /** TOTP sign-in is enabled site-wide (admin toggle). */
  totpEnabled: boolean;
  /** The user's TOTP factor, if any (`confirmed = 0` means setup pending). */
  totpFactor: TotpFactorRow | null;
  /** otpauth:// URI, only present while a factor awaits confirmation. */
  totpUri?: string | null;
  /** True when an AI chat provider is configured for this deployment. */
  aiConfigured: boolean;
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
  logoUrl,
  customCss,
  customJs,
  customFooter,
  csrfToken,
  user,
  section,
  gravatarUrl,
  uploadEnabled,
  fields,
  tags,
  tagCategories,
  blocks,
  blockViewers,
  fieldsPosition,
  identities,
  githubEnabled,
  magicEnabled,
  totpEnabled,
  totpFactor,
  totpUri,
  aiConfigured,
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
  const sectionMeta = DASHBOARD_SECTIONS.find((item) => item.section === section);

  // The Blocks editor lists the blocks and one non-removable row for the
  // key/value card, in the stored order — moving rows is how the profile's
  // section order is set. The row carries `slot=fields` so the route can read
  // its position out of the submitted row order.
  const blockList = section === 'blocks' ? blocks ?? [] : [];
  const fieldsSlotAt = Math.max(0, Math.min(fieldsPosition ?? 0, blockList.length));
  const blockEditorItems: Child[] = [];
  blockList.forEach((block, index) => {
    if (index === fieldsSlotAt) blockEditorItems.push(<FieldsSlotRow key="fields-slot" t={t} />);
    blockEditorItems.push(
      <BlockEditorRow key={block.id} block={block} viewers={blockViewers} t={t} />,
    );
  });
  if (fieldsSlotAt >= blockList.length && section === 'blocks') {
    blockEditorItems.push(<FieldsSlotRow key="fields-slot" t={t} />);
  }

  return (
    <Layout
      appName={appName}
      faviconUrl={faviconUrl}
      logoUrl={logoUrl}
      customCss={customCss}
      customJs={customJs}
      customFooter={customFooter}
      title={section === 'profile' ? t('dash.title') : sectionMeta ? t(sectionMeta.key) : t('dash.title')}
      shell="console"
      csrfToken={csrfToken}
      currentUser={{ username: user.username ?? '', displayName: user.display_name, avatarUrl: user.avatar_url }}
      nonce={nonce}
      t={t}
      locale={locale}
      pathname={pathname}
      isAdmin={isAdmin}
    >
      {/* AI Assistant Modal + floating button: rendered on every dashboard
          section so the assistant stays reachable from anywhere. */}
      <div id="ai-modal" class="fixed inset-0 z-50 hidden">
        <div class="fixed inset-0 bg-black/50" data-ai-close></div>
        <div class="fixed left-1/2 top-1/2 flex w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl bg-card p-6 shadow-xl">
          <div class="mb-4 flex items-center justify-between">
            <h3 class="text-lg font-bold tracking-tight">{t('dash.ai.title')}</h3>
            <button type="button" data-ai-close class="btn-icon" aria-label={t('dash.ai.cancel')}>
              <span class="material-symbols-outlined" aria-hidden="true">close</span>
            </button>
          </div>

          <div id="ai-messages" class="flex h-80 flex-col gap-3 overflow-y-auto rounded-2xl bg-muted/40 p-4"></div>
          <p id="ai-empty" class="mt-2 text-center text-xs text-muted-foreground">{t('dash.ai.empty')}</p>

          <div id="ai-loading" class="hidden mt-2">
            <div class="flex items-center gap-2 text-xs text-muted-foreground">
              <span class="animate-spin material-symbols-outlined icon-sm">refresh</span>
              {t('dash.ai.loading')}
            </div>
          </div>

          <div id="ai-error" class="mt-2 hidden rounded-2xl bg-danger/10 px-4 py-3 text-sm text-danger"></div>

          <div class="mt-4 flex items-end gap-2">
            <textarea
              id="ai-input"
              rows={2}
              placeholder={t('dash.ai.placeholder')}
              class="field min-h-11 flex-1 resize-none"
            ></textarea>
            <button type="button" data-ai-send class="btn-primary shrink-0">
              {t('dash.ai.send')}
            </button>
          </div>
        </div>
      </div>

      {/* Floating AI Button */}
      <button
        type="button"
        data-ai-open
        class="fixed bottom-6 right-6 z-40 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 transition-all duration-200 hover:scale-110"
        aria-label={t('dash.ai.button')}
        title={t('dash.ai.button')}
      >
        <span class="material-symbols-outlined text-2xl" aria-hidden="true">smart_toy</span>
      </button>

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

        {section === 'profile' ? (
          <>
            <div>
              <h1 class="text-xl font-bold tracking-tight">{t('dash.sheetHeading')}</h1>
              <p class="mt-0.5 text-sm text-muted-foreground">
                {t('dash.publicUrl')}{' '}
                <a class="font-semibold text-primary hover:underline" href={`/${user.username}`}>
                  /{user.username}
                </a>
              </p>
            </div>

            <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {DASHBOARD_SECTIONS.filter((item) => item.section !== 'profile').map((item) => (
                <a
                  key={item.path}
                  href={item.path}
                  class="card flex items-center gap-3 p-4 transition hover:border-primary/40 hover:shadow-md"
                >
                  <span class="material-symbols-outlined text-primary" aria-hidden="true">
                    {item.icon}
                  </span>
                  <span class="flex-1 text-sm font-semibold">{t(item.key)}</span>
                  <span class="material-symbols-outlined text-muted-foreground" aria-hidden="true">
                    chevron_right
                  </span>
                </a>
              ))}
            </div>
          </>
        ) : null}

        {section === 'profile' ? (
        <form method="post" action="/dashboard/profile" encType="multipart/form-data" class="card p-6">
          <input type="hidden" name="_csrf" value={csrfToken} />

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
            <div class="flex flex-col gap-2 sm:flex-row sm:items-center" data-gravatar>
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
              {uploadEnabled ? (
                <button
                  type="submit"
                  formaction="/dashboard/avatar/upload"
                  class="btn-outline shrink-0"
                  data-avatar-upload
                  title={t('dash.upload.hint', { max: String(MAX_AVATAR_BYTES / (1024 * 1024)) })}
                >
                  <span class="material-symbols-outlined icon-sm" aria-hidden="true">
                    upload
                  </span>
                  {t('dash.upload.submit')}
                </button>
              ) : null}
            </div>

            {uploadEnabled ? (
              <>
                {/* The file is picked via the Upload button and submitted with
                    the profile form (multipart). Hidden so the visible control
                    is the button only; no `required` — a hidden required
                    control would block the whole form's validation (Save
                    profile) since it cannot be focused. */}
                <input
                  type="file"
                  name="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  class="hidden"
                  data-avatar-file
                />
                <p class="mt-1.5 text-xs text-muted-foreground">
                  {t('dash.upload.hint', { max: String(MAX_AVATAR_BYTES / (1024 * 1024)) })}
                </p>
              </>
            ) : null}
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
              class="field w-full"
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
        ) : null}

        {section === 'security' ? (
          <section class="card p-6">
            <div class="mb-5">
              <h1 class="text-xl font-bold tracking-tight">{t('dash.security.heading')}</h1>
              <p class="mt-0.5 text-sm text-muted-foreground">{t('dash.security.subtitle')}</p>
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

            <TotpCard
              csrfToken={csrfToken}
              totpFactor={totpFactor}
              totpUri={totpUri}
              totpEnabled={totpEnabled}
              t={t}
            />
            </div>
          </section>
        ) : null}

        {section === 'fields' ? (
        <form method="post" action="/dashboard/fields" class="card p-6" data-repeater>
          <input type="hidden" name="_csrf" value={csrfToken} />

          <div class="mb-5">
            <h1 class="text-xl font-bold tracking-tight">{t('dash.fieldsHeading')}</h1>
            <p class="mt-0.5 text-sm text-muted-foreground">{t('dash.fieldsSubtitle')}</p>
          </div>

          <div data-repeater-list>
            {fields.map((field) => (
              <div class="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center" data-repeater-row>
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
                <div class="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    data-repeater-remove
                    class="btn-outline shrink-0 border-danger/30 px-4 text-danger hover:bg-danger/10"
                    aria-label={t('dash.field.remove')}
                    title={t('dash.field.remove')}
                  >
                    <span class="material-symbols-outlined" aria-hidden="true">
                      delete
                    </span>
                  </button>
                  <button
                    type="button"
                    data-repeater-move-up
                    class="btn-icon shrink-0 text-muted-foreground hover:text-foreground"
                    aria-label={t('dash.field.moveUp')}
                    title={t('dash.field.moveUp')}
                  >
                    <span class="material-symbols-outlined" aria-hidden="true">
                      arrow_upward
                    </span>
                  </button>
                  <button
                    type="button"
                    data-repeater-move-down
                    class="btn-icon shrink-0 text-muted-foreground hover:text-foreground"
                    aria-label={t('dash.field.moveDown')}
                    title={t('dash.field.moveDown')}
                  >
                    <span class="material-symbols-outlined" aria-hidden="true">
                      arrow_downward
                    </span>
                  </button>
                </div>
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
            <div class="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center" data-repeater-row>
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
              <div class="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  data-repeater-remove
                  class="btn-outline shrink-0 border-danger/30 px-4 text-danger hover:bg-danger/10"
                  aria-label={t('dash.field.remove')}
                  title={t('dash.field.remove')}
                >
                  <span class="material-symbols-outlined" aria-hidden="true">
                    delete
                  </span>
                </button>
                <button
                  type="button"
                  data-repeater-move-up
                  class="btn-icon shrink-0 text-muted-foreground hover:text-foreground"
                  aria-label={t('dash.field.moveUp')}
                  title={t('dash.field.moveUp')}
                >
                  <span class="material-symbols-outlined" aria-hidden="true">
                    arrow_upward
                  </span>
                </button>
                <button
                  type="button"
                  data-repeater-move-down
                  class="btn-icon shrink-0 text-muted-foreground hover:text-foreground"
                  aria-label={t('dash.field.moveDown')}
                  title={t('dash.field.moveDown')}
                >
                  <span class="material-symbols-outlined" aria-hidden="true">
                    arrow_downward
                  </span>
                </button>
              </div>
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
        ) : null}

        {section === 'blocks' ? (
        <form method="post" action="/dashboard/blocks" class="card p-6" data-repeater data-block-form>
          <input type="hidden" name="_csrf" value={csrfToken} />

          <div class="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 class="text-xl font-bold tracking-tight">{t('dash.blocksHeading')}</h1>
              <p class="mt-0.5 text-sm text-muted-foreground">{t('dash.blocksSubtitle')}</p>
            </div>
            <p
              class="text-xs tabular-nums text-muted-foreground"
              data-block-count
              data-block-max={BLOCK_LIMITS.maxBlocks}
              data-block-template={t('dash.block.count', { count: '{count}', max: String(BLOCK_LIMITS.maxBlocks) })}
            >
              {t('dash.block.count', {
                count: String(blocks?.length ?? 0),
                max: String(BLOCK_LIMITS.maxBlocks),
              })}
            </p>
          </div>

          <div data-repeater-list>
            {blockEditorItems}
          </div>

          <p
            data-block-empty
            class={`rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground ${
              blockList.length ? 'hidden' : ''
            }`}
          >
            {t('dash.noBlocks')}
          </p>

          <template data-repeater-template>
            <BlockEditorRow block={null} viewers={blockViewers} t={t} />
          </template>

          <div class="mt-5 flex flex-wrap gap-3">
            <button type="button" data-repeater-add class="btn-outline">
              <span class="material-symbols-outlined icon-sm" aria-hidden="true">
                add
              </span>
              {t('dash.addBlock')}
            </button>
            <button type="submit" class="btn-primary">
              {t('dash.saveBlocks')}
            </button>
          </div>
        </form>
        ) : null}

        {section === 'tags' ? (
        <form method="post" action="/dashboard/tags" class="card p-6" data-repeater>
          <input type="hidden" name="_csrf" value={csrfToken} />

          <div class="mb-5">
            <h1 class="text-xl font-bold tracking-tight">{t('dash.tagsHeading')}</h1>
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
                  <div class="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center" data-repeater-row>
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
                    <div class="flex shrink-0 items-center gap-2">
                      <TagHiddenToggle hidden={Boolean(tag.hidden)} label={t('dash.tagHidden')} />
                      <button
                        type="button"
                        data-repeater-remove
                        class="btn-outline shrink-0 border-danger/30 px-4 text-danger hover:bg-danger/10"
                        aria-label={t('dash.tag.remove')}
                        title={t('dash.tag.remove')}
                      >
                        <span class="material-symbols-outlined" aria-hidden="true">
                          delete
                        </span>
                      </button>
                      <button
                        type="button"
                        data-repeater-move-up
                        class="btn-icon shrink-0 text-muted-foreground hover:text-foreground"
                        aria-label={t('dash.tag.moveUp')}
                        title={t('dash.tag.moveUp')}
                      >
                        <span class="material-symbols-outlined" aria-hidden="true">
                          arrow_upward
                        </span>
                      </button>
                      <button
                        type="button"
                        data-repeater-move-down
                        class="btn-icon shrink-0 text-muted-foreground hover:text-foreground"
                        aria-label={t('dash.tag.moveDown')}
                        title={t('dash.tag.moveDown')}
                      >
                        <span class="material-symbols-outlined" aria-hidden="true">
                          arrow_downward
                        </span>
                      </button>
                    </div>
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
                <div class="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center" data-repeater-row>
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
                  <div class="flex shrink-0 items-center gap-2">
                    <TagHiddenToggle hidden={false} label={t('dash.tagHidden')} />
                    <button
                      type="button"
                      data-repeater-remove
                      class="btn-outline shrink-0 border-danger/30 px-4 text-danger hover:bg-danger/10"
                      aria-label={t('dash.tag.remove')}
                      title={t('dash.tag.remove')}
                    >
                      <span class="material-symbols-outlined" aria-hidden="true">
                        delete
                      </span>
                    </button>
                    <button
                      type="button"
                      data-repeater-move-up
                      class="btn-icon shrink-0 text-muted-foreground hover:text-foreground"
                      aria-label={t('dash.tag.moveUp')}
                      title={t('dash.tag.moveUp')}
                    >
                      <span class="material-symbols-outlined" aria-hidden="true">
                        arrow_upward
                      </span>
                    </button>
                    <button
                      type="button"
                      data-repeater-move-down
                      class="btn-icon shrink-0 text-muted-foreground hover:text-foreground"
                      aria-label={t('dash.tag.moveDown')}
                      title={t('dash.tag.moveDown')}
                    >
                      <span class="material-symbols-outlined" aria-hidden="true">
                        arrow_downward
                      </span>
                    </button>
                  </div>
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
        ) : null}

        {section === 'ai' ? (
          <section class="card p-6">
            <div class="mb-5">
              <h1 class="text-xl font-bold tracking-tight">{t('dash.ai.heading')}</h1>
              <p class="mt-0.5 text-sm text-muted-foreground">{t('dash.ai.subtitle')}</p>
            </div>
            <div class="flex items-center justify-between gap-3 rounded-2xl bg-muted px-4 py-3">
              <div class="flex min-w-0 items-center gap-3">
                <span class="material-symbols-outlined text-muted-foreground" aria-hidden="true">
                  smart_toy
                </span>
                <div class="min-w-0">
                  <p class="text-sm font-semibold">{t('dash.ai.title')}</p>
                  <p class="truncate text-xs text-muted-foreground">
                    {aiConfigured ? t('dash.account.connected') : t('dash.ai.configureHint')}
                  </p>
                </div>
              </div>
              {aiConfigured ? (
                <span class="rounded-full bg-success/10 px-3 py-1 text-xs font-semibold text-success ring-1 ring-inset ring-success/25">
                  {t('dash.account.connected')}
                </span>
              ) : isAdmin ? (
                <a href="/admin/ai" class="btn-outline shrink-0">
                  <span class="material-symbols-outlined icon-sm" aria-hidden="true">
                    settings
                  </span>
                  {t('admin.nav.ai')}
                </a>
              ) : (
                <span class="text-xs text-muted-foreground">{t('dash.account.notConfigured')}</span>
              )}
            </div>
          </section>
        ) : null}
      </section>

      <script 
        nonce={nonce}
        dangerouslySetInnerHTML={{
          __html: `
            var AI_CSRF = ${JSON.stringify(csrfToken)};
            var AI_LABELS = ${JSON.stringify({
              error: t('dash.ai.error'),
              copy: t('dash.ai.copy'),
              copied: t('dash.ai.copied'),
            })};
            var aiHistory = [];
            var aiStreaming = false;

            document.addEventListener('click', function (ev) {
              var node = ev.target;
              while (node && node !== document.body) {
                if (node.hasAttribute) {
                  if (node.hasAttribute('data-ai-open')) {
                    ev.preventDefault();
                    openAIModal();
                    return;
                  }
                  if (node.hasAttribute('data-ai-close')) {
                    ev.preventDefault();
                    document.getElementById('ai-modal')?.classList.add('hidden');
                    return;
                  }
                  if (node.hasAttribute('data-ai-send')) {
                    ev.preventDefault();
                    sendAIMessage();
                    return;
                  }
                  if (node.hasAttribute('data-ai-copy')) {
                    ev.preventDefault();
                    copyAIMessage(node);
                    return;
                  }
                }
                node = node.parentNode;
              }
            });

            document.addEventListener('keydown', function (ev) {
              if (ev.key !== 'Enter' || ev.shiftKey) return;
              var target = ev.target;
              if (target && target.id === 'ai-input') {
                ev.preventDefault();
                sendAIMessage();
              }
            });

            function openAIModal() {
              document.getElementById('ai-modal')?.classList.remove('hidden');
              updateAIEmpty();
              document.getElementById('ai-input')?.focus();
            }

            function updateAIEmpty() {
              var empty = document.getElementById('ai-empty');
              var list = document.getElementById('ai-messages');
              if (empty && list) empty.classList.toggle('hidden', list.children.length > 0);
            }

            function addBubble(role, text) {
              var list = document.getElementById('ai-messages');
              var row = document.createElement('div');
              row.className = role === 'user' ? 'flex justify-end' : 'flex justify-start';

              var column = document.createElement('div');
              column.className =
                role === 'user'
                  ? 'flex max-w-[80%] flex-col items-end gap-1'
                  : 'flex max-w-[80%] flex-col items-start gap-1';

              var bubble = document.createElement('div');
              bubble.className =
                role === 'user'
                  ? 'whitespace-pre-wrap rounded-2xl bg-primary px-4 py-2 text-sm text-primary-foreground'
                  : 'whitespace-pre-wrap rounded-2xl bg-card px-4 py-2 text-sm text-foreground ring-1 ring-inset ring-border';
              bubble.textContent = text;
              bubble.setAttribute('data-ai-bubble', '');
              column.appendChild(bubble);

              if (role === 'assistant') {
                var copy = document.createElement('button');
                copy.type = 'button';
                copy.setAttribute('data-ai-copy', '');
                copy.className =
                  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground';
                copy.setAttribute('aria-label', AI_LABELS.copy);
                copy.title = AI_LABELS.copy;
                copy.appendChild(copyIcon('content_copy'));
                column.appendChild(copy);
              }

              row.appendChild(column);
              list.appendChild(row);
              list.scrollTop = list.scrollHeight;
              updateAIEmpty();
              return bubble;
            }

            function copyIcon(name) {
              var icon = document.createElement('span');
              icon.className = 'material-symbols-outlined icon-sm';
              icon.setAttribute('aria-hidden', 'true');
              icon.textContent = name;
              return icon;
            }

            function copyAIMessage(button) {
              var column = button.parentNode;
              var bubble = column ? column.querySelector('[data-ai-bubble]') : null;
              var text = bubble ? bubble.textContent : '';
              if (!text) return;
              var done = function () {
                button.textContent = '';
                button.appendChild(copyIcon('check'));
                setTimeout(function () {
                  button.textContent = '';
                  button.appendChild(copyIcon('content_copy'));
                }, 1500);
              };
              if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(done).catch(function () {});
                return;
              }
              var area = document.createElement('textarea');
              area.value = text;
              area.setAttribute('readonly', '');
              area.style.position = 'fixed';
              area.style.opacity = '0';
              document.body.appendChild(area);
              area.select();
              try {
                document.execCommand('copy');
                done();
              } catch (e) {
                /* ignore */
              }
              document.body.removeChild(area);
            }

            function setAIBusy(busy) {
              aiStreaming = busy;
              document.getElementById('ai-loading')?.classList.toggle('hidden', !busy);
            }

            function currentAIContext() {
              var context = {};
              var profileForm = document.querySelector('form[action="/dashboard/profile"]');
              if (profileForm) {
                var names = ['display_name', 'headline', 'bio', 'location', 'website', 'pronouns'];
                for (var i = 0; i < names.length; i++) {
                  var field = profileForm.querySelector('[name="' + names[i] + '"]');
                  if (field) context[names[i]] = field.value;
                }
              }

              var fields = [];
              var fieldsForm = document.querySelector('form[action="/dashboard/fields"]');
              if (fieldsForm) {
                var labels = fieldsForm.querySelectorAll('[data-repeater-row] input[name="label"]');
                var values = fieldsForm.querySelectorAll('[data-repeater-row] input[name="value"]');
                for (var j = 0; j < labels.length; j++) {
                  fields.push({ label: labels[j].value, value: values[j] ? values[j].value : '' });
                }
              }
              context.fields = fields;

              var tags = [];
              var tagsForm = document.querySelector('form[action="/dashboard/tags"]');
              if (tagsForm) {
                var rows = tagsForm.querySelectorAll('[data-repeater-row]');
                for (var k = 0; k < rows.length; k++) {
                  var tagInput = rows[k].querySelector('input[name="tag"]');
                  var select = rows[k].querySelector('select[name="category_id"]');
                  var option = select && select.selectedIndex >= 0 ? select.options[select.selectedIndex] : null;
                  tags.push({
                    value: tagInput ? tagInput.value : '',
                    category: option ? option.textContent : '',
                  });
                }
              }
              context.tags = tags;

              return context;
            }

            function sendAIMessage() {
              if (aiStreaming) return;
              var input = document.getElementById('ai-input');
              var text = input ? input.value.trim() : '';
              if (!text) return;
              if (input) input.value = '';
              var error = document.getElementById('ai-error');
              error?.classList.add('hidden');

              aiHistory.push({ role: 'user', content: text });
              addBubble('user', text);

              var bubble = addBubble('assistant', '');
              setAIBusy(true);

              var answer = '';
              var firstChunk = true;
              fetch('/dashboard/ai/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                  _csrf: AI_CSRF,
                  messages: JSON.stringify(aiHistory.slice(-20)),
                  profile: JSON.stringify(currentAIContext()),
                }),
              })
                .then(function (response) {
                  if (!response.ok || !response.body) {
                    return response
                      .json()
                      .catch(function () {
                        return {};
                      })
                      .then(function (data) {
                        throw new Error((data && data.error) || AI_LABELS.error);
                      });
                  }

                  var reader = response.body.getReader();
                  var decoder = new TextDecoder();
                  var buffer = '';

                  function handleEvent(part) {
                    var line = part.trim();
                    if (line.slice(0, 5) !== 'data:') return;
                    var payload = line.slice(5).trim();
                    if (!payload) return;
                    var event;
                    try {
                      event = JSON.parse(payload);
                    } catch (e) {
                      return;
                    }
                    if (event.delta) {
                      if (firstChunk) {
                        firstChunk = false;
                        document.getElementById('ai-loading')?.classList.add('hidden');
                      }
                      answer += event.delta;
                      bubble.textContent = answer;
                      var list = document.getElementById('ai-messages');
                      if (list) list.scrollTop = list.scrollHeight;
                    } else if (event.error) {
                      throw new Error(event.error);
                    }
                  }

                  function pump() {
                    return reader.read().then(function (result) {
                      if (result.done) {
                        if (answer) aiHistory.push({ role: 'assistant', content: answer });
                        else if (bubble.parentNode) bubble.parentNode.removeChild(bubble);
                        setAIBusy(false);
                        return undefined;
                      }
                      buffer += decoder.decode(result.value, { stream: true });
                      var parts = buffer.split('\\n\\n');
                      buffer = parts.pop() || '';
                      for (var i = 0; i < parts.length; i++) handleEvent(parts[i]);
                      return pump();
                    });
                  }

                  return pump();
                })
                .catch(function (err) {
                  setAIBusy(false);
                  if (!answer && bubble.parentNode) bubble.parentNode.removeChild(bubble);
                  if (error) {
                    error.textContent = (err && err.message) || AI_LABELS.error;
                    error.classList.remove('hidden');
                  }
                });
            }
            
          `
        }}
      />

      <script
        nonce={nonce}
        dangerouslySetInnerHTML={{
          __html: TOTP_QR_SCRIPT({ qrFailed: t('dash.account.totpQrFailed') }),
        }}
      />
    </Layout>
  );
}

/**
 * Narrows a stored visibility (`ProfileBlockRow.visibility` is a plain string
 * — D1 rows are untyped) to the matching audience, with the fallback the
 * dashboard editor should show for a row that no longer matches a known
 * literal. Never `as BlockVisibility`.
 */
function editorVisibility(row: ProfileBlockRow | null): BlockVisibility {
  return row && isBlockVisibility(row.visibility) ? row.visibility : 'public';
}

/** Formats an epoch-ms timestamp as a `datetime-local` value (UTC), or ''. */
function toDateTimeLocal(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '';
  const date = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`
  );
}

/** The usernames listed against one block for `allow`/`deny`, one per line. */
function viewerNames(
  viewers: readonly BlockViewerRow[] | undefined,
  blockId: string | null,
  kind: 'allow' | 'deny',
): string {
  if (!blockId || !viewers) return '';
  return viewers
    .filter((row) => row.block_id === blockId && row.kind === kind && Boolean(row.username))
    .map((row) => row.username as string)
    .join('\n');
}

/**
 * The one non-removable row of the Blocks editor: the key/value ("fields")
 * card. It has no fields of its own — its content is edited on
 * `/dashboard/fields` — and it deliberately has **no remove button**, so the
 * only operations are the up/down arrows that set where the card appears among
 * the blocks. It still carries `data-repeater-row` so REPEATER_SCRIPT moves it.
 */
function FieldsSlotRow({ t }: { t: TranslateFn }) {
  return (
    <div
      class="mb-4 rounded-2xl border border-dashed border-border bg-card/60 p-4"
      data-repeater-row
      data-slot="fields"
    >
      <input type="hidden" name="slot" value="fields" />
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
        <span class="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <span class="material-symbols-outlined" aria-hidden="true">
            list_alt
          </span>
        </span>
        <div class="min-w-0 flex-1">
          <p class="text-sm font-semibold">{t('dash.block.fieldsSlotTitle')}</p>
          <p class="mt-0.5 text-xs text-muted-foreground">{t('dash.block.fieldsSlotHint')}</p>
        </div>
        <a href="/dashboard/fields" class="btn-outline shrink-0">
          {t('dash.block.fieldsSlotEdit')}
        </a>
        <div class="flex shrink-0 items-center gap-2">
          <span
            class="material-symbols-outlined text-muted-foreground"
            aria-hidden="true"
            title={t('dash.block.fieldsSlotLocked')}
          >
            lock
          </span>
          <button
            type="button"
            data-repeater-move-up
            class="btn-icon shrink-0 text-muted-foreground hover:text-foreground"
            aria-label={t('dash.block.moveUp')}
            title={t('dash.block.moveUp')}
          >
            <span class="material-symbols-outlined" aria-hidden="true">
              arrow_upward
            </span>
          </button>
          <button
            type="button"
            data-repeater-move-down
            class="btn-icon shrink-0 text-muted-foreground hover:text-foreground"
            aria-label={t('dash.block.moveDown')}
            title={t('dash.block.moveDown')}
          >
            <span class="material-symbols-outlined" aria-hidden="true">
              arrow_downward
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * One repeater row of the Blocks editor. `block === null` is the blank row
 * cloned from `<template data-repeater-template>` by REPEATER_SCRIPT. Keeping
 * both shapes in one component means a saved row and a fresh row can never
 * drift apart. The kind `<select>` drives which content field is shown via
 * the CSS in app.css (`[data-block-kind]` toggles body/items); both submit so
 * a half-empty row is still caught server-side.
 */
function BlockEditorRow(props: {
  block: ProfileBlockRow | null;
  viewers?: readonly BlockViewerRow[];
  t: TranslateFn;
}) {
  const { block, viewers, t } = props;
  const kind: 'text' | 'gallery' =
    block?.kind === 'text' || block?.kind === 'gallery' ? block.kind : 'text';
  const visibility = editorVisibility(block);
  const items = kind === 'gallery' ? parseGalleryItems(block?.items ?? null).join('\n') : '';
  const requiredTags = parseStoredList(block?.rule_required_tags ?? null).join('\n');
  const excludedTags = parseStoredList(block?.rule_excluded_tags ?? null).join('\n');
  const tagMatch = tagMatchOf(block?.rule_tag_match);
  const relation: BlockRelation | '' = relationOf(block?.rule_relation) ?? '';
  const allowNames = viewerNames(viewers, block?.id ?? null, 'allow');
  const denyNames = viewerNames(viewers, block?.id ?? null, 'deny');

  return (
    <div
      class="mb-4 rounded-2xl bg-muted/40 p-4"
      data-repeater-row
      data-block-row
      data-block-kind={kind}
    >
      <input type="hidden" name="slot" value="block" />
      <div class="flex flex-col gap-2 sm:flex-row">
        <select
          name="kind"
          data-block-kind-select
          class="field sm:w-40"
          aria-label={t('dash.block.kind')}
        >
          {(['text', 'gallery'] as const).map((value) => (
            <option value={value} selected={value === kind}>
              {blockKindLabel(value, t)}
            </option>
          ))}
        </select>
        <input
          name="title"
          value={block?.title ?? ''}
          placeholder={t('dash.block.titlePlaceholder')}
          maxlength={BLOCK_LIMITS.maxTitleLength}
          class="field min-w-0 flex-1"
          aria-label={t('dash.block.title')}
        />
        <select
          name="visibility"
          class="field sm:w-56"
          aria-label={t('dash.block.audience')}
        >
          {audienceOptions(t).map((option) => (
            <option value={option.value} selected={option.value === visibility}>
              {option.label}
            </option>
          ))}
        </select>
        <div class="flex shrink-0 items-center gap-2">
          <button
            type="button"
            data-repeater-remove
            class="btn-outline shrink-0 border-danger/30 px-4 text-danger hover:bg-danger/10"
            aria-label={t('dash.block.remove')}
            title={t('dash.block.remove')}
          >
            <span class="material-symbols-outlined" aria-hidden="true">
              delete
            </span>
          </button>
          <button
            type="button"
            data-repeater-move-up
            class="btn-icon shrink-0 text-muted-foreground hover:text-foreground"
            aria-label={t('dash.block.moveUp')}
            title={t('dash.block.moveUp')}
          >
            <span class="material-symbols-outlined" aria-hidden="true">
              arrow_upward
            </span>
          </button>
          <button
            type="button"
            data-repeater-move-down
            class="btn-icon shrink-0 text-muted-foreground hover:text-foreground"
            aria-label={t('dash.block.moveDown')}
            title={t('dash.block.moveDown')}
          >
            <span class="material-symbols-outlined" aria-hidden="true">
              arrow_downward
            </span>
          </button>
        </div>
      </div>

      <div data-block-conditions class="mt-3 rounded-xl bg-card/50 p-3">
        <div class="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('dash.block.conditions')}
        </div>

        {/* Follow & account: the relational audience plus the two age gates.
            Grouped so the three "who counts" rules read as one decision. */}
        <div class="space-y-2" data-rule-group="relation">
          <p class="text-xs font-medium text-foreground/70">{t('dash.block.groupRelation')}</p>
          <div class="grid gap-3 sm:grid-cols-3">
            <label class="flex flex-col gap-1">
              <span class="text-xs text-muted-foreground">{t('dash.block.relation')}</span>
              <select name="relation" class="field w-full" aria-label={t('dash.block.relation')}>
                <option value="" selected={relation === ''}>
                  {t('dash.block.relationNone')}
                </option>
                {RELATIONS.map((value) => (
                  <option value={value} selected={value === relation}>
                    {t(`block.relation.${value}`)}
                  </option>
                ))}
              </select>
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-xs text-muted-foreground">{t('dash.block.minFollowDays')}</span>
              <input
                name="min_follow_days"
                type="number"
                min={0}
                max={BLOCK_LIMITS.maxMinDays}
                step={1}
                value={block?.rule_min_follow_days ?? ''}
                placeholder={t('dash.block.minFollowDaysPlaceholder')}
                class="field w-full"
                aria-label={t('dash.block.minFollowDays')}
              />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-xs text-muted-foreground">{t('dash.block.minAccountAgeDays')}</span>
              <input
                name="min_account_age_days"
                type="number"
                min={0}
                max={BLOCK_LIMITS.maxMinDays}
                step={1}
                value={block?.rule_min_account_age_days ?? ''}
                placeholder={t('dash.block.minAccountAgeDaysPlaceholder')}
                class="field w-full"
                aria-label={t('dash.block.minAccountAgeDays')}
              />
            </label>
          </div>
        </div>

        {/* Tags: the required list, how it is matched, and the exclusions. */}
        <div class="mt-3 space-y-2" data-rule-group="tags">
          <p class="text-xs font-medium text-foreground/70">{t('dash.block.groupTags')}</p>
          <div class="grid gap-3 sm:grid-cols-3">
            <label class="flex flex-col gap-1">
              <span class="text-xs text-muted-foreground">{t('dash.block.requiredTags')}</span>
              <textarea
                name="required_tags"
                rows={2}
                placeholder={t('dash.block.requiredTagsPlaceholder')}
                autocomplete="off"
                class="field w-full font-mono text-xs"
                aria-label={t('dash.block.requiredTags')}
              >
                {requiredTags}
              </textarea>
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-xs text-muted-foreground">{t('dash.block.tagMatch')}</span>
              <select name="tag_match" class="field w-full" aria-label={t('dash.block.tagMatch')}>
                <option value="any" selected={tagMatch === 'any'}>
                  {t('dash.block.tagMatchAny')}
                </option>
                <option value="all" selected={tagMatch === 'all'}>
                  {t('dash.block.tagMatchAll')}
                </option>
              </select>
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-xs text-muted-foreground">{t('dash.block.excludedTags')}</span>
              <textarea
                name="excluded_tags"
                rows={2}
                placeholder={t('dash.block.excludedTagsPlaceholder')}
                autocomplete="off"
                class="field w-full font-mono text-xs"
                aria-label={t('dash.block.excludedTags')}
              >
                {excludedTags}
              </textarea>
            </label>
          </div>
        </div>

        {/* Time window: the two ends of the same window, side by side. */}
        <div class="mt-3 space-y-2" data-rule-group="window">
          <p class="text-xs font-medium text-foreground/70">{t('dash.block.groupWindow')}</p>
          <div class="grid gap-3 sm:grid-cols-2">
            <label class="flex flex-col gap-1">
              <span class="text-xs text-muted-foreground">{t('dash.block.visibleFrom')}</span>
              <input
                name="visible_from"
                type="datetime-local"
                value={toDateTimeLocal(block?.rule_visible_from)}
                class="field w-full"
                aria-label={t('dash.block.visibleFrom')}
              />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-xs text-muted-foreground">{t('dash.block.visibleUntil')}</span>
              <input
                name="visible_until"
                type="datetime-local"
                value={toDateTimeLocal(block?.rule_visible_until)}
                class="field w-full"
                aria-label={t('dash.block.visibleUntil')}
              />
            </label>
          </div>
        </div>

        {/* Named people: the allow list narrows, the deny list excludes. */}
        <div class="mt-3 space-y-2" data-rule-group="users">
          <p class="text-xs font-medium text-foreground/70">{t('dash.block.groupUsers')}</p>
          <div class="grid gap-3 sm:grid-cols-2">
            <div data-user-picker class="relative flex flex-col gap-1">
              <span class="text-xs text-muted-foreground">{t('dash.block.allowUsers')}</span>
              <input
                type="text"
                data-user-input
                placeholder={t('dash.block.userSearchPlaceholder')}
                autocomplete="off"
                class="field w-full"
                aria-label={t('dash.block.allowUsers')}
              />
              <textarea
                name="allow_users"
                data-user-list
                rows={2}
                placeholder={t('dash.block.usersPlaceholder')}
                class="field w-full font-mono text-xs"
                aria-label={t('dash.block.allowUsers')}
              >
                {allowNames}
              </textarea>
            </div>
            <div data-user-picker class="relative flex flex-col gap-1">
              <span class="text-xs text-muted-foreground">{t('dash.block.denyUsers')}</span>
              <input
                type="text"
                data-user-input
                placeholder={t('dash.block.userSearchPlaceholder')}
                autocomplete="off"
                class="field w-full"
                aria-label={t('dash.block.denyUsers')}
              />
              <textarea
                name="deny_users"
                data-user-list
                rows={2}
                placeholder={t('dash.block.usersPlaceholder')}
                class="field w-full font-mono text-xs"
                aria-label={t('dash.block.denyUsers')}
              >
                {denyNames}
              </textarea>
            </div>
          </div>
        </div>

        <p class="mt-3 text-xs leading-relaxed text-muted-foreground">
          {t('dash.block.conditionsHint')}
        </p>
      </div>

      <div data-block-text class="mt-2">
        <textarea
          name="body"
          rows={3}
          maxlength={BLOCK_LIMITS.maxBodyLength}
          placeholder={t('dash.block.bodyPlaceholder')}
          class="field w-full"
          aria-label={t('dash.block.body')}
        >
          {block?.body ?? ''}
        </textarea>
        <p class="mt-1.5 text-xs leading-relaxed text-muted-foreground">
          {t('dash.field.bioHint')}
        </p>
      </div>

      <div data-block-gallery class="mt-2">
        <textarea
          name="items"
          rows={3}
          placeholder={t('dash.block.itemsPlaceholder')}
          class="field w-full font-mono text-xs"
          aria-label={t('dash.block.items')}
        >
          {items}
        </textarea>
      </div>
    </div>
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

/**
 * TOTP management card (Security section). Each form is wired to htmx so the
 * key is generated / confirmed / removed with an in-place swap of this card
 * instead of a full page reload (which would scroll the page back to the top).
 * The same component renders the `#totp-card` fragment returned by the TOTP
 * endpoints when the request comes from htmx.
 */
export function TotpCard(props: {
  csrfToken: string;
  totpFactor: TotpFactorRow | null;
  totpUri?: string | null;
  totpEnabled: boolean;
  message?: string;
  error?: string;
  t: TranslateFn;
}) {
  const { csrfToken, totpFactor, totpUri, totpEnabled, message, error, t } = props;
  return (
    <div id="totp-card" class="rounded-2xl bg-muted px-4 py-3">
      {message || error ? (
        <div class="mb-3 space-y-2">
          {error ? (
            <p class="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger ring-1 ring-inset ring-danger/25">
              {error}
            </p>
          ) : null}
          {message ? (
            <p class="rounded-xl bg-success/10 px-3 py-2 text-sm text-success ring-1 ring-inset ring-success/25">
              {message}
            </p>
          ) : null}
        </div>
      ) : null}

      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex min-w-0 items-center gap-3">
          <span class="material-symbols-outlined text-muted-foreground" aria-hidden="true">
            security
          </span>
          <div class="min-w-0">
            <p class="text-sm font-semibold">{t('dash.account.totp')}</p>
            <p class="truncate text-xs text-muted-foreground">
              {totpFactor
                ? totpFactor.confirmed
                  ? t('dash.account.connected')
                  : t('dash.account.totpPending')
                : t('dash.account.notConnected')}
            </p>
          </div>
        </div>
        {totpFactor?.confirmed ? (
          <span class="rounded-full bg-success/10 px-3 py-1 text-xs font-semibold text-success ring-1 ring-inset ring-success/25">
            {t('dash.account.connected')}
          </span>
        ) : null}
      </div>

      {totpFactor && !totpFactor.confirmed ? (
        <div class="mt-4 space-y-3">
          <div class="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div
              data-totp-qr
              data-totp-uri={totpUri ?? ''}
              class="grid h-44 w-44 shrink-0 place-items-center overflow-hidden rounded-2xl bg-card p-2 text-center text-xs text-muted-foreground [&_svg]:h-full [&_svg]:w-full"
            />
            <div class="min-w-0 space-y-2">
              <p class="text-sm text-muted-foreground">{t('dash.account.totpScanHint')}</p>
              <p class="text-sm text-muted-foreground">{t('dash.account.totpManualHint')}</p>
              <code class="block select-all break-all rounded-xl bg-card px-3 py-2 text-xs tracking-widest">
                {totpFactor.secret}
              </code>
            </div>
          </div>
          <form
            method="post"
            action="/dashboard/totp/confirm"
            hx-post="/dashboard/totp/confirm"
            hx-target="#totp-card"
            hx-swap="outerHTML"
            hx-scroll="false"
            class="flex flex-col gap-2 sm:flex-row"
          >
            <input type="hidden" name="_csrf" value={csrfToken} />
            <input
              type="text"
              name="code"
              required
              inputmode="numeric"
              maxlength={9}
              autocomplete="one-time-code"
              placeholder={t('dash.account.totpCodeLabel')}
              aria-label={t('dash.account.totpCodeLabel')}
              class="field min-w-0 flex-1"
            />
            <button type="submit" class="btn-primary shrink-0">
              {t('dash.account.totpConfirm')}
            </button>
            <button
              type="submit"
              formaction="/dashboard/totp/setup"
              hx-post="/dashboard/totp/setup"
              hx-target="#totp-card"
              hx-swap="outerHTML"
              hx-scroll="false"
              class="btn-outline shrink-0"
            >
              {t('dash.account.totpRegenerate')}
            </button>
          </form>
        </div>
      ) : null}

      {!totpFactor && totpEnabled ? (
        <form
          method="post"
          action="/dashboard/totp/setup"
          hx-post="/dashboard/totp/setup"
          hx-target="#totp-card"
          hx-swap="outerHTML"
          hx-scroll="false"
          class="mt-3"
        >
          <input type="hidden" name="_csrf" value={csrfToken} />
          <button type="submit" class="btn-outline">
            <span class="material-symbols-outlined icon-sm" aria-hidden="true">
              add
            </span>
            {t('dash.account.totpSetup')}
          </button>
        </form>
      ) : null}

      {totpFactor?.confirmed ? (
        <>
          <form
            method="post"
            action="/dashboard/totp/disable"
            hx-post="/dashboard/totp/disable"
            hx-target="#totp-card"
            hx-swap="outerHTML"
            hx-scroll="false"
            class="mt-3 flex flex-col gap-2 sm:flex-row"
          >
            <input type="hidden" name="_csrf" value={csrfToken} />
            <input
              type="text"
              name="code"
              required
              inputmode="numeric"
              maxlength={9}
              autocomplete="one-time-code"
              placeholder={t('dash.account.totpCodeLabel')}
              aria-label={t('dash.account.totpCodeLabel')}
              class="field min-w-0 flex-1"
            />
            <button
              type="submit"
              class="btn-outline shrink-0 border-danger/30 text-danger hover:bg-danger/10"
            >
              <span class="material-symbols-outlined icon-sm" aria-hidden="true">
                delete
              </span>
              {t('dash.account.totpRemove')}
            </button>
          </form>
          <p class="mt-2 text-xs text-muted-foreground">{t('dash.account.totpRemoveHint')}</p>
        </>
      ) : null}
    </div>
  );
}

