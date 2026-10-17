/** Presentational view for the admin panel; all writes are posted to `/admin/*`. */
import { Layout } from './layout';
import type {
  BanStateRow,
  ModerationActionRow,
  ReportRow,
  ReportStatus,
  TagCategoryRow,
  UserBanRow,
  UserRow,
} from '../db/types';
import { TAG_COLORS, tagChipClasses } from '../lib/tags';
import { THEMES, VISIBILITIES } from '../lib/themes';
import type { AdminStats } from '../db/queries';
import { ADMIN_SECTIONS, type AdminSection } from '../lib/admin-nav';
import { MAX_LANDING_COPY, MAX_LANDING_URL, type LandingCopyKey, type SiteSettings } from '../lib/settings';
import type { EnvLocks } from '../lib/config';
import {
  BAN_DURATIONS,
  MAX_BAN_NOTE,
  MAX_MODERATION_NOTE,
  MAX_RECEIPT_BODY,
  REPORT_REASONS,
  REPORT_REASON_KEYS,
  REPORT_STATUSES,
  REPORT_STATUS_KEYS,
  banDurationKey,
  isBanActive,
  isReportReason,
} from '../lib/moderation';
import type { Locale, MessageKey, TranslateFn } from '../i18n';

const CUSTOM_CODE_MAX = 32768;

/**
 * Classic-script bootstrap for the three CodeMirror editors in the custom-code
 * card (CSS, JS, and the HTML footer). It dynamic-imports the locally-bundled
 * `public/vendor/codemirror.js` (built by `scripts/build-vendor.mjs`), then
 * replaces each server-rendered textarea with an `EditorView` that keeps the
 * original textarea in sync, so the form still submits the code with or without
 * JavaScript. On any load failure the plain textareas stay visible as a
 * fallback and a status line explains why. Locale strings are passed in as a
 * JSON literal, like the other page scripts.
 */
function codeMirrorScript(t: TranslateFn): string {
  const msg = JSON.stringify({ loadError: t('admin.code.loadError'), count: t('admin.code.count') });
  return `(function(){
var hosts=document.querySelectorAll('[data-cm-editor]');
if(!hosts.length)return;
var MAX=${CUSTOM_CODE_MAX};
var MSG=${msg};
function fmtCount(n){return MSG.count.split('{count}').join(n).split('{max}').join(MAX);}
function setStatus(text){var el=document.querySelector('[data-cm-status]');if(el)el.textContent=text;}
function mountAll(stateMod,viewMod,langMod,cmdMod,cssMod,jsMod,htmlMod,tagsMod){
var highlight=langMod.HighlightStyle.define([
{tag:[tagsMod.tags.comment,tagsMod.tags.lineComment,tagsMod.tags.blockComment],color:'hsl(var(--muted-foreground))'},
{tag:[tagsMod.tags.keyword,tagsMod.tags.operatorKeyword,tagsMod.tags.controlKeyword,tagsMod.tags.moduleKeyword],color:'hsl(var(--primary))'},
{tag:[tagsMod.tags.string],color:'hsl(var(--success))'},
{tag:[tagsMod.tags.number,tagsMod.tags.bool,tagsMod.tags.null,tagsMod.tags.atom,tagsMod.tags.unit],color:'hsl(var(--warning))'},
{tag:[tagsMod.tags.function(tagsMod.tags.variableName)],color:'hsl(var(--secondary))'},
{tag:[tagsMod.tags.definition(tagsMod.tags.variableName),tagsMod.tags.definition(tagsMod.tags.propertyName)],color:'hsl(var(--foreground))'},
{tag:[tagsMod.tags.variableName,tagsMod.tags.propertyName],color:'hsl(var(--foreground))'},
{tag:[tagsMod.tags.tagName],color:'hsl(var(--primary))'},
{tag:[tagsMod.tags.className,tagsMod.tags.special(tagsMod.tags.string)],color:'hsl(var(--success))'},
{tag:[tagsMod.tags.attributeName],color:'hsl(var(--secondary))'},
{tag:[tagsMod.tags.operator,tagsMod.tags.punctuation,tagsMod.tags.bracket],color:'hsl(var(--muted-foreground))'},
{tag:[tagsMod.tags.invalid],color:'hsl(var(--danger))'}
]);
var spans=document.querySelectorAll('[data-cm-count]');
function build(host,span){
var ta=host.querySelector('textarea');
if(!ta||host.hasAttribute('data-cm-ready'))return;
host.setAttribute('data-cm-ready','');
var kind=host.getAttribute('data-cm-editor');
var langExt=kind==='css'?cssMod.css():kind==='html'?htmlMod.html():jsMod.javascript();
var wrap=document.createElement('div');
host.insertBefore(wrap,ta);
ta.setAttribute('data-cm-hidden','');
ta.setAttribute('tabindex','-1');
var state=stateMod.EditorState.create({
doc:ta.value,
extensions:[
langExt,
langMod.syntaxHighlighting(highlight,{fallback:true}),
viewMod.EditorView.lineWrapping,
viewMod.lineNumbers(),
cmdMod.history(),
        viewMod.keymap.of(cmdMod.defaultKeymap),
        viewMod.keymap.of(cmdMod.historyKeymap),
        viewMod.keymap.of([cmdMod.indentWithTab]),
viewMod.EditorView.updateListener.of(function(u){
if(u.docChanged){ta.value=u.state.doc.toString();if(span)span.textContent=fmtCount(ta.value.length);}
})
]
});
new viewMod.EditorView({parent:wrap,state:state});
}
for(var i=0;i<hosts.length;i++)build(hosts[i],spans[i]);
}
import('/vendor/codemirror.js').then(function(m){mountAll(m.state,m.view,m.language,m.commands,m.langCss,m.langJs,m.langHtml,m.highlight);}).catch(function(){setStatus(MSG.loadError);});
})();`;
}

export interface AdminViewProps {
  appName: string;
  csrfToken: string;
  t: TranslateFn;
  locale: Locale;
  /** Which sub-module page to render (drives the sidebar's second level). */
  section: AdminSection;
  pathname: string;
  currentUser: { username: string; displayName?: string | null } | null;
  selfId: string;
  envAdminEmails: string[];
  settings: SiteSettings;
  integrations: {
    githubClientId: string;
    githubClientSecretSet: boolean;
    mailerDriver: string;
    smtpHost: string;
    smtpPort: string;
    smtpSecure: string;
    smtpUser: string;
    smtpPasswordSet: boolean;
    smtpFrom: string;
    gravatarMirror: string;
    openaiApiKeySet: boolean;
    openaiBaseUrl: string;
    openaiModel: string;
    openaiPromptChat: string;
  };
  envLocks: EnvLocks;
  githubCallbackUrl: string;
  stats: AdminStats;
  reserved: string[];
  tagCategories: TagCategoryRow[];
  users: UserRow[];
  reports: ReportRow[];
  bans: UserBanRow[];
  moderationStats: {
    open: number;
    resolved: number;
    dismissed: number;
    activeBans: number;
  };
  actionLog: ModerationActionRow[];
  reportStatus: ReportStatus | 'all';
  banTarget: { user: UserRow; ban: BanStateRow | null } | null;
  receiptUnread?: number;
  query: string;
  message?: string;
  error?: string;
  nonce?: string;
}

function formatDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function reportReasonLabel(reason: string, t: TranslateFn): string {
  return isReportReason(reason) ? t(REPORT_REASON_KEYS[reason]) : reason;
}

function banStateLabel(ban: UserBanRow, t: TranslateFn): string {
  if (ban.revoked_at !== null) return t('admin.moderation.state.revoked');
  if (!isBanActive(ban)) return t('admin.moderation.state.expired');
  return t('admin.moderation.state.active');
}

function actionLabel(action: string, t: TranslateFn): string {
  const key = `admin.moderation.action.${action}` as MessageKey;
  return t(key);
}

const REPORT_FILTERS = ['open', 'resolved', 'dismissed', 'all'] as const;

function reportFilterKey(status: (typeof REPORT_FILTERS)[number]): MessageKey {
  switch (status) {
    case 'resolved':
      return 'admin.moderation.filter.resolved';
    case 'dismissed':
      return 'admin.moderation.filter.dismissed';
    case 'all':
      return 'admin.moderation.filter.all';
    default:
      return 'admin.moderation.filter.open';
  }
}

export function AdminView({
  appName,
  csrfToken,
  t,
  locale,
  section,
  pathname,
  currentUser,
  selfId,
  envAdminEmails,
  settings,
  integrations,
  envLocks,
  githubCallbackUrl,
  stats,
  reserved,
  tagCategories,
  users,
  reports,
  bans,
  moderationStats,
  actionLog,
  reportStatus,
  banTarget,
  receiptUnread,
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
  const sectionMeta = ADMIN_SECTIONS.find((item) => item.section === section);
  const pageTitle =
    section === 'overview' || !sectionMeta ? t('admin.title') : t(sectionMeta.key);

  return (
    <Layout
      appName={appName}
      faviconUrl={settings.faviconUrl}
      logoUrl={settings.logoUrl}
      title={pageTitle}
      shell="console"
      csrfToken={csrfToken}
      currentUser={currentUser}
      nonce={nonce}
      t={t}
      locale={locale}
      pathname={pathname}
      isAdmin
      receiptUnread={receiptUnread}
      customCss={settings.customCss}
      customJs={settings.customJs}
      customFooter={settings.customFooter}
    >
      <section class="space-y-6">
        {section === 'overview' ? (
          <div>
            <h1 class="text-xl font-bold tracking-tight">{t('admin.heading')}</h1>
            <p class="mt-0.5 text-sm text-muted-foreground">{t('admin.subtitle')}</p>
          </div>
        ) : null}

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

        {section === 'overview' ? (
          <>
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

            <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {ADMIN_SECTIONS.filter(
                (item) => item.section !== 'overview' && item.section !== 'moderation',
              ).map((item) => (
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

        {section === 'settings' ? (
        <form method="post" action="/admin/settings" class="card p-6">
          <input type="hidden" name="_csrf" value={csrfToken} />
          <div class="mb-5">
            <h2 class="text-lg font-bold tracking-tight">{t('admin.settings.heading')}</h2>
            <p class="mt-0.5 text-sm text-muted-foreground">{t('admin.settings.subtitle')}</p>
          </div>

          <div class="grid gap-4 sm:grid-cols-2">
            <ConfigField
              id="site_name"
              name="site_name"
              label={t('admin.settings.siteName')}
              value={envLocks.siteName ? appName : settings.siteName}
              maxLength={60}
              hint={t('admin.settings.siteNameHint')}
              locked={envLocks.siteName}
              t={t}
            />
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
            <div>
              <label class="label" for="logo_url">
                {t('admin.settings.logo')}
              </label>
              <input
                id="logo_url"
                name="logo_url"
                value={settings.logoUrl}
                maxlength={500}
                placeholder="https://example.com/logo.png"
                class="field"
              />
              <p class="mt-1 px-1 text-xs text-muted-foreground">
                {t('admin.settings.logoHint')}
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
            <Toggle
              name="totp_login_enabled"
              label={t('admin.settings.totp')}
              checked={settings.totpLoginEnabled}
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
        ) : null}

        {section === 'integrations' ? (
        <>
        <form method="post" action="/admin/config/github" class="card p-6">
          <input type="hidden" name="_csrf" value={csrfToken} />
          <div class="mb-5">
            <h2 class="text-lg font-bold tracking-tight">{t('admin.integrations.githubHeading')}</h2>
            <p class="mt-0.5 text-sm text-muted-foreground">{t('admin.integrations.subtitle')}</p>
          </div>
          <div class="grid gap-4 sm:grid-cols-2">
            <ConfigField
              id="github_client_id"
              name="github_client_id"
              label={t('admin.integrations.clientId')}
              value={integrations.githubClientId}
              locked={envLocks.githubClientId}
              t={t}
            />
            <ConfigField
              id="github_client_secret"
              name="github_client_secret"
              type="password"
              label={t('admin.integrations.clientSecret')}
              placeholder={
                integrations.githubClientSecretSet ? t('admin.integrations.secretSet') : undefined
              }
              locked={envLocks.githubClientSecret}
              warnInsecure
              insecureEnv="GITHUB_CLIENT_SECRET"
              t={t}
            />
          </div>
          <p class="mt-2 px-1 text-xs text-muted-foreground">
            {t('admin.integrations.githubHint')}{' '}
            <code class="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
              {githubCallbackUrl}
            </code>
          </p>

          <div class="mt-6 flex justify-end">
            <button type="submit" class="btn-primary">
              {t('admin.save')}
            </button>
          </div>
        </form>

        <form method="post" action="/admin/config/email" class="card p-6">
          <input type="hidden" name="_csrf" value={csrfToken} />
          <div class="mb-5">
            <h2 class="text-lg font-bold tracking-tight">{t('admin.integrations.emailHeading')}</h2>
            <p class="mt-0.5 text-sm text-muted-foreground">{t('admin.integrations.subtitle')}</p>
          </div>
          <div class="grid gap-4 sm:grid-cols-2">
            <ConfigSelect
              id="mailer_driver"
              name="mailer_driver"
              label={t('admin.integrations.driver')}
              value={integrations.mailerDriver}
              options={[
                { value: '', label: t('admin.integrations.driverConsole') },
                { value: 'smtp', label: t('admin.integrations.driverSmtp') },
              ]}
              locked={envLocks.mailerDriver}
              t={t}
            />
            <ConfigField
              id="smtp_host"
              name="smtp_host"
              label={t('admin.integrations.smtpHost')}
              value={integrations.smtpHost}
              locked={envLocks.smtpHost}
              t={t}
            />
            <ConfigField
              id="smtp_port"
              name="smtp_port"
              label={t('admin.integrations.smtpPort')}
              value={integrations.smtpPort}
              placeholder="465"
              locked={envLocks.smtpPort}
              t={t}
            />
            <ConfigSelect
              id="smtp_secure"
              name="smtp_secure"
              label={t('admin.integrations.smtpSecure')}
              value={integrations.smtpSecure}
              options={[
                { value: '', label: t('admin.integrations.smtpSecureAuto') },
                { value: 'tls', label: t('admin.integrations.smtpSecureTls') },
                { value: 'starttls', label: t('admin.integrations.smtpSecureStarttls') },
                { value: 'none', label: t('admin.integrations.smtpSecureNone') },
              ]}
              locked={envLocks.smtpSecure}
              t={t}
            />
            <ConfigField
              id="smtp_user"
              name="smtp_user"
              label={t('admin.integrations.smtpUser')}
              value={integrations.smtpUser}
              locked={envLocks.smtpUser}
              t={t}
            />
            <ConfigField
              id="smtp_password"
              name="smtp_password"
              type="password"
              label={t('admin.integrations.smtpPassword')}
              placeholder={
                integrations.smtpPasswordSet ? t('admin.integrations.secretSet') : undefined
              }
              locked={envLocks.smtpPassword}
              warnInsecure
              insecureEnv="SMTP_PASSWORD"
              t={t}
            />
            <ConfigField
              id="smtp_from"
              name="smtp_from"
              label={t('admin.integrations.smtpFrom')}
              value={integrations.smtpFrom}
              placeholder="EarthOL <no-reply@example.com>"
              locked={envLocks.smtpFrom}
              t={t}
            />
          </div>

          <div class="mt-6 flex justify-end">
            <button type="submit" class="btn-primary">
              {t('admin.save')}
            </button>
          </div>
        </form>

        <form method="post" action="/admin/config/gravatar" class="card p-6">
          <input type="hidden" name="_csrf" value={csrfToken} />
          <div class="mb-5">
            <h2 class="text-lg font-bold tracking-tight">{t('admin.integrations.gravatarHeading')}</h2>
            <p class="mt-0.5 text-sm text-muted-foreground">{t('admin.integrations.subtitle')}</p>
          </div>

          <ConfigField
            id="gravatar_mirror"
            name="gravatar_mirror"
            label={t('admin.integrations.gravatarMirror')}
            value={integrations.gravatarMirror}
            placeholder="https://www.gravatar.com/avatar"
            hint={t('admin.integrations.gravatarHint')}
            locked={envLocks.gravatarMirror}
            t={t}
          />

          <div class="mt-6 flex justify-end">
            <button type="submit" class="btn-primary">
              {t('admin.save')}
            </button>
          </div>
        </form>
        </>
        ) : null}

        {section === 'ai' ? (
        <form method="post" action="/admin/ai" class="card p-6">
          <input type="hidden" name="_csrf" value={csrfToken} />
          <div class="mb-5">
            <h2 class="text-lg font-bold tracking-tight">{t('admin.ai.heading')}</h2>
            <p class="mt-0.5 text-sm text-muted-foreground">{t('admin.ai.subtitle')}</p>
          </div>

          <div class="grid gap-4 sm:grid-cols-2">
            <ConfigField
              id="openai_api_key"
              name="openai_api_key"
              type="password"
              label={t('admin.ai.apiKey')}
              placeholder={integrations.openaiApiKeySet ? t('admin.integrations.secretSet') : undefined}
              locked={envLocks.openaiApiKey}
              warnInsecure
              insecureEnv="OPENAI_API_KEY"
              t={t}
            />
            <ConfigField
              id="openai_base_url"
              name="openai_base_url"
              label={t('admin.ai.baseUrl')}
              value={integrations.openaiBaseUrl}
              placeholder="https://api.openai.com/v1"
              hint={t('admin.ai.baseUrlHint')}
              locked={envLocks.openaiBaseUrl}
              t={t}
            />
            <ConfigField
              id="openai_model"
              name="openai_model"
              label={t('admin.ai.model')}
              value={integrations.openaiModel}
              placeholder="gpt-3.5-turbo"
              hint={t('admin.ai.modelHint')}
              locked={envLocks.openaiModel}
              t={t}
            />
          </div>

          <div class="mt-4">
            <label class="label mb-1.5" for="openai_prompt_chat">
              {t('admin.ai.prompt')}
            </label>
            <textarea
              id="openai_prompt_chat"
              name="openai_prompt_chat"
              rows={4}
              class="field w-full"
              placeholder={t('admin.ai.promptHint')}
            >{integrations.openaiPromptChat}</textarea>
          </div>

          <div class="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              class="btn-outline"
              hx-post="/admin/ai/test"
              hx-target="#ai-test-result"
              hx-swap="outerHTML"
              hx-vals={JSON.stringify({ _csrf: csrfToken })}
            >
              {t('admin.ai.test')}
            </button>
            <div id="ai-test-result" class="min-h-4 text-xs text-muted-foreground"></div>
          </div>

          <div class="mt-6 flex justify-end">
            <button type="submit" class="btn-primary">
              {t('admin.save')}
            </button>
          </div>
        </form>
        ) : null}

        {section === 'code' ? (
        <>
        <form method="post" action="/admin/custom-code" class="card p-6">
          <input type="hidden" name="_csrf" value={csrfToken} />
          <div class="mb-5">
            <h2 class="text-lg font-bold tracking-tight">{t('admin.code.heading')}</h2>
            <p class="mt-0.5 text-sm text-muted-foreground">{t('admin.code.subtitle')}</p>
          </div>

          <div class="mb-4">
            <div class="mb-1.5 flex items-center justify-between gap-3">
              <label class="label mb-0" for="custom_css">
                {t('admin.code.css')}
              </label>
              <span data-cm-count class="text-xs tabular-nums text-muted-foreground">
                {t('admin.code.count', { count: settings.customCss.length, max: CUSTOM_CODE_MAX })}
              </span>
            </div>
            <div data-cm-editor="css">
              <textarea id="custom_css" name="custom_css" rows={12} spellCheck={false} class="code-source">
                {settings.customCss}
              </textarea>
            </div>
            <p class="mt-1.5 text-xs text-muted-foreground">{t('admin.code.cssHint')}</p>
          </div>

          <div class="mb-4">
            <div class="mb-1.5 flex items-center justify-between gap-3">
              <label class="label mb-0" for="custom_js">
                {t('admin.code.js')}
              </label>
              <span data-cm-count class="text-xs tabular-nums text-muted-foreground">
                {t('admin.code.count', { count: settings.customJs.length, max: CUSTOM_CODE_MAX })}
              </span>
            </div>
            <div data-cm-editor="js">
              <textarea id="custom_js" name="custom_js" rows={12} spellCheck={false} class="code-source">
                {settings.customJs}
              </textarea>
            </div>
            <p class="mt-1.5 text-xs text-muted-foreground">{t('admin.code.jsHint')}</p>
          </div>

          <div class="mb-4">
            <div class="mb-1.5 flex items-center justify-between gap-3">
              <label class="label mb-0" for="custom_footer">
                {t('admin.code.footer')}
              </label>
              <span data-cm-count class="text-xs tabular-nums text-muted-foreground">
                {t('admin.code.count', { count: settings.customFooter.length, max: CUSTOM_CODE_MAX })}
              </span>
            </div>
            <div data-cm-editor="html">
              <textarea id="custom_footer" name="custom_footer" rows={8} spellCheck={false} class="code-source">
                {settings.customFooter}
              </textarea>
            </div>
            <p class="mt-1.5 text-xs text-muted-foreground">{t('admin.code.footerHint')}</p>
          </div>

          <div class="flex items-center justify-between gap-3">
            <p data-cm-status class="min-h-4 text-xs text-muted-foreground" />
            <button type="submit" class="btn-primary">
              {t('admin.code.save')}
            </button>
          </div>
        </form>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: codeMirrorScript(t) }} />
        </>
        ) : null}

        {section === 'landing' ? (
        <form method="post" action="/admin/landing" class="card p-6">
          <input type="hidden" name="_csrf" value={csrfToken} />
          <div class="mb-5">
            <h2 class="text-lg font-bold tracking-tight">{t('admin.landing.heading')}</h2>
            <p class="mt-0.5 text-sm text-muted-foreground">{t('admin.landing.desc')}</p>
          </div>

          <div class="space-y-4">
            <LandingField
              name="badge"
              label={t('admin.landing.badge')}
              value={settings.landingCopy.badge}
              placeholder={t('home.badge')}
            />
            <div class="grid gap-4 sm:grid-cols-3">
              <LandingField
                name="heroLead"
                label={t('admin.landing.heroLead')}
                value={settings.landingCopy.heroLead}
                placeholder={t('home.heroLead')}
              />
              <LandingField
                name="heroAccent"
                label={t('admin.landing.heroAccent')}
                value={settings.landingCopy.heroAccent}
                placeholder={t('home.heroAccent')}
              />
              <LandingField
                name="heroTail"
                label={t('admin.landing.heroTail')}
                value={settings.landingCopy.heroTail}
                placeholder={t('home.heroTail')}
              />
            </div>
            <LandingField
              name="subtitle"
              label={t('admin.landing.subtitle')}
              value={settings.landingCopy.subtitle}
              placeholder={t('home.subtitle')}
              multiline
            />
            <div class="grid gap-4 sm:grid-cols-2">
              <LandingField
                name="ctaClaim"
                label={t('admin.landing.ctaClaim')}
                value={settings.landingCopy.ctaClaim}
                placeholder={t('home.ctaClaim')}
              />
              <LandingField
                name="ctaHow"
                label={t('admin.landing.ctaHow')}
                value={settings.landingCopy.ctaHow}
                placeholder={t('home.ctaHow')}
              />
            </div>

            <div class="grid gap-4 sm:grid-cols-2">
              <div>
                <label class="label" for="landing_ctaClaimUrl">
                  {t('admin.landing.ctaClaimUrl')}
                </label>
                <input
                  id="landing_ctaClaimUrl"
                  name="ctaClaimUrl"
                  value={settings.landingCtaPrimaryUrl}
                  maxlength={MAX_LANDING_URL}
                  placeholder="/login"
                  class="field"
                />
              </div>
              <div>
                <label class="label" for="landing_ctaHowUrl">
                  {t('admin.landing.ctaHowUrl')}
                </label>
                <input
                  id="landing_ctaHowUrl"
                  name="ctaHowUrl"
                  value={settings.landingCtaSecondaryUrl}
                  maxlength={MAX_LANDING_URL}
                  placeholder="#how"
                  class="field"
                />
              </div>
            </div>
            <p class="px-1 text-xs text-muted-foreground">{t('admin.landing.linkHint')}</p>
          </div>

          <div class="mt-6 space-y-4">
            <div class="space-y-3 rounded-2xl border border-border bg-muted/40 p-4">
              <LandingField
                name="step1Title"
                label={t('admin.landing.step1Title')}
                value={settings.landingCopy.step1Title}
                placeholder={t('home.step1Title')}
              />
              <LandingField
                name="step1Body"
                label={t('admin.landing.step1Body')}
                value={settings.landingCopy.step1Body}
                placeholder={t('home.step1Body')}
                multiline
              />
            </div>
            <div class="space-y-3 rounded-2xl border border-border bg-muted/40 p-4">
              <LandingField
                name="step2Title"
                label={t('admin.landing.step2Title')}
                value={settings.landingCopy.step2Title}
                placeholder={t('home.step2Title')}
              />
              <LandingField
                name="step2Body"
                label={t('admin.landing.step2Body')}
                value={settings.landingCopy.step2Body}
                placeholder={t('home.step2Body')}
                multiline
              />
            </div>
            <div class="space-y-3 rounded-2xl border border-border bg-muted/40 p-4">
              <LandingField
                name="step3Title"
                label={t('admin.landing.step3Title')}
                value={settings.landingCopy.step3Title}
                placeholder={t('home.step3Title')}
              />
              <LandingField
                name="step3Body"
                label={t('admin.landing.step3Body')}
                value={settings.landingCopy.step3Body}
                placeholder={t('home.step3Body')}
                multiline
              />
            </div>
          </div>

          <p class="mt-4 px-1 text-xs text-muted-foreground">{t('admin.landing.hint')}</p>
          <div class="mt-4 flex justify-end">
            <button type="submit" class="btn-primary">
              {t('admin.landing.save')}
            </button>
          </div>
        </form>
        ) : null}

        {section === 'reserved' ? (
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
        ) : null}

        {section === 'tags' ? (
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
        ) : null}

        {section === 'users' ? (
        <div class="card p-6">
          <div class="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 class="text-lg font-bold tracking-tight">{t('admin.users.heading')}</h2>
              <p class="mt-0.5 text-sm text-muted-foreground">{t('admin.users.subtitle')}</p>
            </div>
            <form method="get" action="/admin/users" class="flex gap-2">
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
                    const isBanned = row.is_banned === 1;
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
                            {isBanned ? (
                              <span class="chip bg-danger/10 text-danger">
                                {t('admin.users.banned')}
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
                              <a
                                href={`/admin/moderation?ban=${encodeURIComponent(row.id)}`}
                                class="btn-outline px-3 py-1 text-xs"
                              >
                                {t('admin.users.moderate')}
                              </a>
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
        ) : null}

        {section === 'moderation' ? (
        <>
          <div class="grid gap-4 sm:grid-cols-3">
            <div class="card p-5">
              <p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('admin.moderation.stat.open')}
              </p>
              <p class="mt-1 text-3xl font-bold tabular-nums">{moderationStats.open}</p>
            </div>
            <div class="card p-5">
              <p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('admin.moderation.stat.bans')}
              </p>
              <p class="mt-1 text-3xl font-bold tabular-nums">{moderationStats.activeBans}</p>
            </div>
            <div class="card p-5">
              <p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('admin.moderation.stat.resolved')}
              </p>
              <p class="mt-1 text-3xl font-bold tabular-nums">
                {moderationStats.resolved + moderationStats.dismissed}
              </p>
            </div>
          </div>

          {banTarget ? (
            <div class="card p-6">
              <div class="mb-4">
                <h2 class="text-lg font-bold tracking-tight">
                  {t('admin.moderation.banHeading', {
                    username: banTarget.user.username ?? banTarget.user.display_name ?? '—',
                  })}
                </h2>
                <p class="mt-0.5 text-sm text-muted-foreground">
                  {t('admin.moderation.banSubtitle')}
                </p>
              </div>

              {banTarget.ban && isBanActive(banTarget.ban) ? (
                <div class="space-y-4">
                  <div class="rounded-2xl bg-muted p-4 text-sm">
                    <p class="font-semibold text-danger">{t('admin.moderation.state.active')}</p>
                    <p class="mt-1">
                      {t('admin.moderation.reason')}: {reportReasonLabel(banTarget.ban.reason, t)}
                    </p>
                    <p class="mt-1 text-muted-foreground">
                      {banTarget.ban.expires_at === null
                        ? t('admin.moderation.permanent')
                        : t('admin.moderation.until', { date: formatDate(banTarget.ban.expires_at) })}
                    </p>
                    {banTarget.ban.note ? (
                      <p class="mt-1 whitespace-pre-wrap text-muted-foreground">{banTarget.ban.note}</p>
                    ) : null}
                  </div>
                  <form method="post" action="/admin/moderation/unban" class="flex flex-col gap-2 sm:flex-row sm:items-end">
                    <input type="hidden" name="_csrf" value={csrfToken} />
                    <input type="hidden" name="user_id" value={banTarget.user.id} />
                    <div class="flex-1">
                      <label class="label" for="unban-note">
                        {t('admin.moderation.note')}
                      </label>
                      <input id="unban-note" name="note" maxlength={MAX_BAN_NOTE} class="field" />
                    </div>
                    <button type="submit" class="btn-outline border-danger/30 text-danger hover:bg-danger/10">
                      {t('admin.moderation.unban')}
                    </button>
                  </form>
                </div>
              ) : (
                <form method="post" action="/admin/moderation/ban" class="space-y-4">
                  <input type="hidden" name="_csrf" value={csrfToken} />
                  <input type="hidden" name="user_id" value={banTarget.user.id} />
                  <div class="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label class="label" for="ban-reason">
                        {t('admin.moderation.reason')}
                      </label>
                      <select id="ban-reason" name="reason" class="field" required>
                        {REPORT_REASONS.map((reason) => (
                          <option value={reason}>{t(REPORT_REASON_KEYS[reason])}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label class="label" for="ban-duration">
                        {t('admin.moderation.duration')}
                      </label>
                      <select id="ban-duration" name="duration" class="field" required>
                        {BAN_DURATIONS.map((duration) => (
                          <option value={duration.id}>{t(banDurationKey(duration.id))}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label class="label" for="ban-note">
                      {t('admin.moderation.banNote')}
                    </label>
                    <textarea
                      id="ban-note"
                      name="note"
                      rows={3}
                      maxlength={MAX_BAN_NOTE}
                      class="field w-full"
                    />
                  </div>
                  <p class="rounded-2xl bg-muted px-4 py-3 text-xs text-muted-foreground">
                    {t('admin.moderation.banEffect')}
                  </p>
                  <div class="flex flex-wrap gap-2">
                    <button type="submit" class="btn-primary">
                      <span class="material-symbols-outlined icon-sm" aria-hidden="true">
                        gavel
                      </span>
                      {t('admin.moderation.applyBan')}
                    </button>
                    <a href="/admin/moderation" class="btn-outline">
                      {t('admin.moderation.cancel')}
                    </a>
                  </div>
                </form>
              )}
            </div>
          ) : null}

          <div class="card p-6">
            <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 class="text-lg font-bold tracking-tight">{t('admin.moderation.queue')}</h2>
                <p class="mt-0.5 text-sm text-muted-foreground">{t('admin.moderation.queueSubtitle')}</p>
              </div>
              <div class="flex flex-wrap gap-1.5">
                {REPORT_FILTERS.map((filter) => (
                  <a
                    href={`/admin/moderation?status=${filter}`}
                    class={
                      reportStatus === filter
                        ? 'chip bg-primary/10 font-semibold text-primary'
                        : 'chip bg-muted text-muted-foreground hover:text-foreground'
                    }
                  >
                    {t(reportFilterKey(filter))}
                  </a>
                ))}
              </div>
            </div>

            {reports.length === 0 ? (
              <p class="rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">
                {t('admin.moderation.none')}
              </p>
            ) : (
              <div class="space-y-3">
                {reports.map((report) => (
                  <div class="rounded-2xl border border-border p-4" data-report>
                    <div class="flex flex-wrap items-start justify-between gap-2">
                      <div class="min-w-0">
                        <p class="flex flex-wrap items-center gap-2 text-sm font-semibold">
                          {report.target_username ? (
                            <a
                              href={`/${report.target_username}`}
                              class="hover:text-primary hover:underline"
                            >
                              @{report.target_username}
                            </a>
                          ) : (
                            <span>{t('admin.moderation.unknownUser')}</span>
                          )}
                          <span class="chip bg-muted text-muted-foreground">
                            {reportReasonLabel(report.reason, t)}
                          </span>
                          <span
                            class={
                              report.status === 'open'
                                ? 'chip bg-warning/10 text-warning'
                                : report.status === 'resolved'
                                  ? 'chip bg-success/10 text-success'
                                  : 'chip bg-muted text-muted-foreground'
                            }
                          >
                            {t(REPORT_STATUS_KEYS[report.status as ReportStatus])}
                          </span>
                        </p>
                        <p class="mt-1 text-xs text-muted-foreground">
                          {t('admin.moderation.reporter')}:{' '}
                          {report.reporter_username ? `@${report.reporter_username}` : t('admin.moderation.unknownUser')}
                          {' · '}
                          {formatDate(report.created_at)}
                        </p>
                      </div>
                      <div class="flex flex-wrap gap-2">
                        {report.target_username ? (
                          <a
                            href={`/admin/moderation?ban=${encodeURIComponent(report.target_user_id)}`}
                            class="btn-outline px-3 py-1 text-xs border-danger/30 text-danger hover:bg-danger/10"
                          >
                            {t('admin.moderation.ban')}
                          </a>
                        ) : null}
                      </div>
                    </div>

                    {report.details ? (
                      <p class="mt-3 whitespace-pre-wrap rounded-xl bg-muted px-3 py-2 text-sm text-foreground/90">
                        {report.details}
                      </p>
                    ) : null}

                    {report.status !== 'open' ? (
                      <p class="mt-2 text-xs text-muted-foreground">
                        {t('admin.moderation.handledBy', {
                          name: report.handler_username ? `@${report.handler_username}` : t('admin.moderation.unknownUser'),
                          date: report.handled_at ? formatDate(report.handled_at) : '—',
                        })}
                        {report.resolution ? ` · ${report.resolution}` : ''}
                      </p>
                    ) : null}

                    <form
                      method="post"
                      action={`/admin/moderation/reports/${report.id}/status`}
                      class="mt-3 space-y-2"
                    >
                      <input type="hidden" name="_csrf" value={csrfToken} />
                      <input type="hidden" name="filter" value={reportStatus} />
                      <div class="flex flex-col gap-2 sm:flex-row sm:items-end">
                        <div class="sm:w-40">
                          <label class="label" for={`report-status-${report.id}`}>
                            {t('admin.moderation.status')}
                          </label>
                          <select
                            id={`report-status-${report.id}`}
                            name="status"
                            class="field"
                          >
                            {REPORT_STATUSES.map((status) => (
                              <option value={status} selected={status === report.status}>
                                {t(REPORT_STATUS_KEYS[status])}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div class="flex-1">
                          <label class="label" for={`report-note-${report.id}`}>
                            {t('admin.moderation.note')}
                          </label>
                          <input
                            id={`report-note-${report.id}`}
                            name="note"
                            maxlength={MAX_MODERATION_NOTE}
                            class="field"
                          />
                        </div>
                        <button type="submit" class="btn-outline shrink-0">
                          {t('admin.moderation.update')}
                        </button>
                      </div>
                      <div>
                        <label class="label" for={`report-receipt-${report.id}`}>
                          {t('admin.moderation.receipt')}
                        </label>
                        <textarea
                          id={`report-receipt-${report.id}`}
                          name="receipt"
                          rows={2}
                          maxlength={MAX_RECEIPT_BODY}
                          placeholder={t('admin.moderation.receiptHint')}
                          class="field w-full"
                        />
                      </div>
                    </form>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div class="card p-6">
            <div class="mb-4">
              <h2 class="text-lg font-bold tracking-tight">{t('admin.moderation.bans')}</h2>
              <p class="mt-0.5 text-sm text-muted-foreground">{t('admin.moderation.bansSubtitle')}</p>
            </div>
            {bans.length === 0 ? (
              <p class="rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">
                {t('admin.moderation.bansNone')}
              </p>
            ) : (
              <div class="overflow-x-auto">
                <table class="w-full text-left text-sm">
                  <thead class="text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th class="py-2 pr-4 font-semibold">{t('admin.moderation.target')}</th>
                      <th class="py-2 pr-4 font-semibold">{t('admin.moderation.reason')}</th>
                      <th class="py-2 pr-4 font-semibold">{t('admin.moderation.state')}</th>
                      <th class="py-2 pr-4 font-semibold">{t('admin.moderation.until')}</th>
                      <th class="py-2 pr-4 font-semibold">{t('admin.users.col.actions')}</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-border">
                    {bans.map((ban) => (
                      <tr key={`${ban.user_id}:${ban.created_at}`}>
                        <td class="py-2.5 pr-4">
                          {ban.username ? (
                            <a href={`/${ban.username}`} class="font-semibold hover:text-primary hover:underline">
                              @{ban.username}
                            </a>
                          ) : (
                            <span class="font-semibold">{t('admin.moderation.unknownUser')}</span>
                          )}
                          <p class="text-xs text-muted-foreground">by {ban.created_by_username ? `@${ban.created_by_username}` : '—'}</p>
                        </td>
                        <td class="py-2.5 pr-4">
                          <p>{reportReasonLabel(ban.reason, t)}</p>
                          {ban.note ? (
                            <p class="max-w-xs whitespace-pre-wrap text-xs text-muted-foreground">{ban.note}</p>
                          ) : null}
                        </td>
                        <td class="py-2.5 pr-4">
                          <span
                            class={
                              isBanActive(ban)
                                ? 'chip bg-danger/10 text-danger'
                                : 'chip bg-muted text-muted-foreground'
                            }
                          >
                            {banStateLabel(ban, t)}
                          </span>
                        </td>
                        <td class="py-2.5 pr-4 text-muted-foreground tabular-nums">
                          {ban.expires_at === null
                            ? t('admin.moderation.permanent')
                            : formatDate(ban.expires_at)}
                        </td>
                        <td class="py-2.5 pr-4">
                          {isBanActive(ban) ? (
                            <form method="post" action="/admin/moderation/unban" class="contents">
                              <input type="hidden" name="_csrf" value={csrfToken} />
                              <input type="hidden" name="user_id" value={ban.user_id} />
                              <button type="submit" class="btn-outline px-3 py-1 text-xs">
                                {t('admin.moderation.unban')}
                              </button>
                            </form>
                          ) : (
                            <a href={`/admin/moderation?ban=${encodeURIComponent(ban.user_id)}`} class="btn-ghost px-3 py-1 text-xs">
                              {t('admin.moderation.reban')}
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div class="card p-6">
            <div class="mb-4">
              <h2 class="text-lg font-bold tracking-tight">{t('admin.moderation.history')}</h2>
              <p class="mt-0.5 text-sm text-muted-foreground">{t('admin.moderation.historySubtitle')}</p>
            </div>
            {actionLog.length === 0 ? (
              <p class="rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">
                {t('admin.moderation.historyNone')}
              </p>
            ) : (
              <ul class="space-y-2 text-sm">
                {actionLog.map((entry) => (
                  <li key={entry.id} class="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-border/60 pb-2 last:border-0 last:pb-0">
                    <span class="font-semibold">{actionLabel(entry.action, t)}</span>
                    {entry.target_username ? (
                      <a href={`/${entry.target_username}`} class="text-muted-foreground hover:text-primary hover:underline">
                        @{entry.target_username}
                      </a>
                    ) : null}
                    <span class="text-xs text-muted-foreground">
                      {t('admin.moderation.by', {
                        name: entry.actor_username ? `@${entry.actor_username}` : t('admin.moderation.unknownUser'),
                      })}
                      {' · '}
                      {formatDate(entry.created_at)}
                    </span>
                    {entry.note ? (
                      <span class="w-full text-xs text-muted-foreground">{entry.note}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
        ) : null}
      </section>
    </Layout>
  );
}

/**
 * A single landing-page copy input. `name` doubles as the form field name (the
 * `POST /admin/landing` handler reads it back by the same key) and the `home.*`
 * message it overrides; the built-in text is passed in as the placeholder.
 */
function LandingField(props: {
  name: LandingCopyKey;
  label: string;
  value: string;
  placeholder: string;
  multiline?: boolean;
}) {
  const id = `landing_${props.name}`;
  return (
    <div>
      <label class="label" for={id}>
        {props.label}
      </label>
      {props.multiline ? (
        <textarea
          id={id}
          name={props.name}
          rows={3}
          maxlength={MAX_LANDING_COPY}
          placeholder={props.placeholder}
          class="field w-full"
        >{props.value}</textarea>
      ) : (
        <input
          id={id}
          name={props.name}
          value={props.value}
          maxlength={MAX_LANDING_COPY}
          placeholder={props.placeholder}
          class="field"
        />
      )}
    </div>
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

/**
 * Text/password field for the integrations card. `locked` is the name of the
 * env var that owns the value (or null when editable); a locked field renders
 * disabled and the server ignores its submitted value, so the env var wins.
 */
function ConfigField(props: {
  id: string;
  name: string;
  label: string;
  value?: string;
  type?: string;
  placeholder?: string;
  maxLength?: number;
  hint?: string;
  locked: string | null;
  /** Secret fields: flag a typed value as insecure (see `data-secret-input`). */
  warnInsecure?: boolean;
  /** Env var recommended as the secure alternative (interpolated in the hint). */
  insecureEnv?: string;
  t: TranslateFn;
}) {
  const warn = props.warnInsecure && !props.locked;
  return (
    <div>
      <label class="label" for={props.id}>
        {props.label}
      </label>
      <input
        id={props.id}
        name={props.name}
        type={props.type ?? 'text'}
        value={props.value ?? ''}
        // A placeholder is required for the CSS `:not(:placeholder-shown)`
        // warning to react to typed values.
        placeholder={props.placeholder ?? (warn ? ' ' : undefined)}
        maxlength={props.maxLength}
        disabled={Boolean(props.locked)}
        data-secret-input={warn ? '' : undefined}
        class={`field${props.locked ? ' cursor-not-allowed opacity-60' : ''}`}
      />
      {warn ? (
        <p class="secret-warning mt-1 items-start gap-1 px-1 text-xs text-warning">
          <span class="material-symbols-outlined icon-xs" aria-hidden="true">
            warning
          </span>
          {props.t('admin.integrations.insecure', { name: props.insecureEnv ?? '' })}
        </p>
      ) : null}
      <EnvLockHint locked={props.locked} hint={props.hint} t={props.t} />
    </div>
  );
}

/** Select counterpart of `ConfigField`, with the same env-lock behaviour. */
function ConfigSelect(props: {
  id: string;
  name: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  hint?: string;
  locked: string | null;
  t: TranslateFn;
}) {
  return (
    <div>
      <label class="label" for={props.id}>
        {props.label}
      </label>
      <select
        id={props.id}
        name={props.name}
        disabled={Boolean(props.locked)}
        class={`field appearance-none pr-10${props.locked ? ' cursor-not-allowed opacity-60' : ''}`}
      >
        {props.options.map((option) => (
          <option value={option.value} selected={option.value === props.value}>
            {option.label}
          </option>
        ))}
      </select>
      <EnvLockHint locked={props.locked} hint={props.hint} t={props.t} />
    </div>
  );
}

/** Shows the lock note for env-owned fields, otherwise the optional hint. */
function EnvLockHint({
  locked,
  hint,
  t,
}: {
  locked: string | null;
  hint?: string;
  t: TranslateFn;
}) {
  if (locked) {
    return (
      <p class="mt-1 flex items-center gap-1 px-1 text-xs text-warning">
        <span class="material-symbols-outlined icon-xs" aria-hidden="true">
          lock
        </span>
        {t('admin.integrations.locked', { name: locked })}
      </p>
    );
  }
  return hint ? <p class="mt-1 px-1 text-xs text-muted-foreground">{hint}</p> : null;
}
