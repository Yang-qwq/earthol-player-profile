/**
 * Shared HTML shell: `<head>` (CSP-friendly inline scripts, fonts, favicon),
 * the public top bar, and the console (dashboard/admin) sidebar. Every page
 * view renders through this component.
 */
import type { PropsWithChildren } from 'hono/jsx';
import { htmlLang, LOCALES, type Locale, type TranslateFn } from '../i18n';
import { isSafeFaviconUrl, rawInlineBlock } from '../lib/validate';

export interface LayoutProps {
  title?: string;
  description?: string;
  appName: string;
  faviconUrl: string;
  logoUrl?: string;
  currentUser?: { username: string; displayName?: string | null } | null;
  csrfToken?: string;
  robots?: string;
  canonical?: string;
  shell?: 'page' | 'console';
  /** Per-request CSP nonce for the inline scripts below. */
  nonce?: string;
  t: TranslateFn;
  locale: Locale;
  pathname: string;
  isAdmin?: boolean;
  /** Admin-authored CSS, injected on every page (see the admin custom-code card). */
  customCss?: string;
  /** Admin-authored JS, injected on every page (see the admin custom-code card). */
  customJs?: string;
  /** Admin-authored raw HTML footer; replaces the default footer when set. */
  customFooter?: string;
  og?: {
    title: string;
    description: string;
    url: string;
    image?: string | null;
    type?: string;
  };
}

// Hardcoded project repository link.
const GITHUB_REPO_URL = 'https://github.com/Yang-qwq/earthol-player-profile';

const NAV_SCRIPT = `(function(){function shell(){return document.getElementById('console-shell');}function setNav(open){var s=shell();if(s)s.classList.toggle('nav-open',open);}document.addEventListener('click',function(ev){var t=ev.target;while(t&&t!==document.body){if(t.hasAttribute){if(t.hasAttribute('data-nav-open')){setNav(true);return;}if(t.hasAttribute('data-nav-close')){setNav(false);return;}}t=t.parentNode;}});document.addEventListener('keydown',function(ev){if(ev.key==='Escape')setNav(false);});window.addEventListener('pageshow',function(){setNav(false);});})();`;

const THEME_SCRIPT = `(function(){var d=document.documentElement;function mode(){try{var s=localStorage.getItem('ui-theme');if(s==='light'||s==='dark')return s;}catch(e){}return window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}function apply(m){d.classList.toggle('dark',m==='dark');d.style.colorScheme=m;}apply(mode());if(window.matchMedia){try{window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change',function(){var s=null;try{s=localStorage.getItem('ui-theme');}catch(e){}if(s!=='light'&&s!=='dark'){apply(mode());}});}catch(e){}}window.toggleTheme=function(){var m=d.classList.contains('dark')?'light':'dark';apply(m);try{localStorage.setItem('ui-theme',m);}catch(e){}};document.addEventListener('click',function(ev){var t=ev.target;while(t&&t!==document.body){if(t.getAttribute&&t.getAttribute('data-theme-toggle')!==null){toggleTheme();return;}t=t.parentNode;}});})();`;

// Repeatable form rows (dashboard fields/tags). Rows are server-rendered; the
// template holds an empty row cloned by the add button. No eval, so it stays
// compatible with the strict CSP.
const REPEATER_SCRIPT = `(function(){function rows(form){return form.querySelectorAll('[data-repeater-row]');}function update(form){var empty=form.querySelector('[data-repeater-empty]');if(empty)empty.classList.toggle('hidden',rows(form).length>0);}function add(form){var list=form.querySelector('[data-repeater-list]');var tpl=form.querySelector('template[data-repeater-template]');if(!list||!tpl||!tpl.content.firstElementChild)return;var node=tpl.content.firstElementChild.cloneNode(true);list.appendChild(node);update(form);var focus=node.querySelector('input, select');if(focus)focus.focus();}function remove(btn){var form=btn.closest('[data-repeater]');if(!form)return;var row=btn.closest('[data-repeater-row]');if(row&&row.parentNode)row.parentNode.removeChild(row);update(form);}function moveUp(btn){var form=btn.closest('[data-repeater]');if(!form)return;var row=btn.closest('[data-repeater-row]');if(!row)return;var prev=row.previousElementSibling;var list=row.parentNode;if(!prev||!list)return;list.insertBefore(row,prev);}function moveDown(btn){var form=btn.closest('[data-repeater]');if(!form)return;var row=btn.closest('[data-repeater-row]');if(!row)return;var next=row.nextElementSibling;var list=row.parentNode;if(!next||!list)return;list.insertBefore(next,row);}function init(){var forms=document.querySelectorAll('[data-repeater]');for(var i=0;i<forms.length;i++){(function(form){update(form);form.addEventListener('click',function(ev){var t=ev.target;while(t&&t!==form){if(t.hasAttribute){if(t.hasAttribute('data-repeater-add')){ev.preventDefault();add(form);return;}if(t.hasAttribute('data-repeater-remove')){ev.preventDefault();remove(t);return;}if(t.hasAttribute('data-repeater-move-up')){ev.preventDefault();moveUp(t);return;}if(t.hasAttribute('data-repeater-move-down')){ev.preventDefault();moveDown(t);return;}}t=t.parentNode;}});})(forms[i]);}}if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',init);}else{init();}})();`;

// Icon dropdowns (e.g. the language switcher). Toggled via data attributes and
// event delegation; no eval, so it stays compatible with the strict CSP.
const DROPDOWN_SCRIPT = `(function(){function close(dd){if(!dd)return;dd.removeAttribute('data-open');var b=dd.querySelector('[data-dropdown-toggle]');if(b)b.setAttribute('aria-expanded','false');}function closeAll(except){var list=document.querySelectorAll('[data-dropdown][data-open]');for(var i=0;i<list.length;i++){if(list[i]!==except)close(list[i]);}}document.addEventListener('click',function(ev){var t=ev.target;while(t&&t!==document.body){if(t.hasAttribute&&t.hasAttribute('data-dropdown-toggle')){ev.preventDefault();var dd=t.closest('[data-dropdown]');if(!dd)return;var open=dd.hasAttribute('data-open');closeAll(dd);if(open){close(dd);}else{dd.setAttribute('data-open','');t.setAttribute('aria-expanded','true');}return;}t=t.parentNode;}closeAll(null);});document.addEventListener('keydown',function(ev){if(ev.key==='Escape')closeAll(null);});})();`;

// Tag value autocomplete. Suggestions come from values other users already
// entered in the same category (`GET /api/tag-suggestions`). Arrow keys move,
// Tab/Enter accept, Escape dismisses. Suggestions are inserted with textContent
// so user-provided values can never inject markup.
const TAG_AUTOCOMPLETE_SCRIPT = `(function(){var box=null,input=null,items=[],index=-1,timer=null,seq=0;function close(){if(box&&box.parentNode)box.parentNode.removeChild(box);box=null;input=null;items=[];index=-1;}function paint(){if(!box)return;box.textContent='';for(var i=0;i<items.length;i++){(function(i){var item=document.createElement('button');item.type='button';item.className='tag-suggest-item';item.setAttribute('role','option');item.setAttribute('aria-selected',i===index?'true':'false');item.textContent=items[i];item.addEventListener('mousedown',function(ev){ev.preventDefault();pick(i);});box.appendChild(item);})(i);}}function pick(i){if(!input||items[i]===undefined)return;input.value=items[i];close();}function open(inp,list){close();input=inp;items=list;index=0;box=document.createElement('div');box.className='tag-suggest';box.setAttribute('role','listbox');inp.parentNode.appendChild(box);paint();}function load(inp){var row=inp.parentNode&&inp.parentNode.parentNode;var sel=row?row.querySelector('[data-tag-category]'):null;if(!sel||!sel.value){close();return;}var mine=++seq;var url='/api/tag-suggestions?category_id='+encodeURIComponent(sel.value)+'&q='+encodeURIComponent(inp.value.trim());fetch(url,{headers:{Accept:'application/json'}}).then(function(r){return r.ok?r.json():[];}).then(function(list){if(mine!==seq)return;if(!Array.isArray(list)){close();return;}list=list.filter(function(v){return v!==inp.value.trim();});if(!list.length){close();return;}open(inp,list);}).catch(function(){});}document.addEventListener('input',function(ev){var t=ev.target;if(!t||!t.hasAttribute||!t.hasAttribute('data-tag-input'))return;if(timer)clearTimeout(timer);timer=setTimeout(function(){load(t);},160);});document.addEventListener('focusin',function(ev){var t=ev.target;if(t&&t.hasAttribute&&t.hasAttribute('data-tag-input'))load(t);});document.addEventListener('keydown',function(ev){var t=ev.target;if(!t||!t.hasAttribute||!t.hasAttribute('data-tag-input'))return;if(!box||input!==t)return;if(ev.key==='ArrowDown'){ev.preventDefault();index=(index+1)%items.length;paint();}else if(ev.key==='ArrowUp'){ev.preventDefault();index=(index-1+items.length)%items.length;paint();}else if(ev.key==='Tab'||ev.key==='Enter'){if(index>=0){ev.preventDefault();pick(index);}}else if(ev.key==='Escape'){close();}});document.addEventListener('click',function(ev){if(!box)return;var t=ev.target;if(t===input||box.contains(t))return;close();});})();`;

// Toggles a tag row's hidden flag. The paired hidden input always submits a
// value, so the `hidden`/`tag`/`category_id` arrays stay index-aligned.
const TAG_HIDDEN_SCRIPT = `(function(){document.addEventListener('click',function(ev){var t=ev.target;while(t&&t!==document.body){if(t.hasAttribute&&t.hasAttribute('data-tag-hidden-toggle')){ev.preventDefault();var row=t.closest('[data-repeater-row]');var field=row?row.querySelector('[data-tag-hidden-input]'):null;var on=t.getAttribute('aria-pressed')==='true';t.setAttribute('aria-pressed',on?'false':'true');if(field)field.value=on?'0':'1';return;}t=t.parentNode;}});})();`;

// Fills the avatar URL input with the server-computed Gravatar URL (dashboard).
// Event delegation; no inline handlers, so it stays CSP-compatible.
const GRAVATAR_SCRIPT = `(function(){document.addEventListener('click',function(ev){var t=ev.target;while(t&&t!==document.body){if(t.hasAttribute&&t.hasAttribute('data-gravatar-url')){ev.preventDefault();var row=t.closest('[data-gravatar]');var input=row?row.querySelector('[data-avatar-input]'):null;var url=t.getAttribute('data-gravatar-url');if(input&&url){input.value=url;input.focus();}return;}t=t.parentNode;}});})();`;

function Logo({
  appName,
  logoUrl,
  href = '/',
  hideTextOnMobile = false,
}: {
  appName: string;
  logoUrl?: string;
  href?: string;
  hideTextOnMobile?: boolean;
}) {
  const hasLogo = Boolean(logoUrl && isSafeFaviconUrl(logoUrl));
  return (
    <a href={href} class="flex min-w-0 items-center gap-2.5">
      {hasLogo ? (
        <img
          src={logoUrl}
          alt=""
          class="h-9 w-9 shrink-0 rounded-xl object-cover shadow-sm"
        />
      ) : null}
      <span
        class={`whitespace-nowrap text-base font-bold tracking-tight ${hideTextOnMobile ? 'hidden sm:inline' : ''
          }`}
      >
        {appName}
      </span>
    </a>
  );
}

function ThemeToggle({ t }: { t: TranslateFn }) {
  const label = t('action.toggleTheme');
  return (
    <button type="button" class="btn-icon" aria-label={label} title={label} data-theme-toggle="true">
      <span class="material-symbols-outlined theme-icon-light" aria-hidden="true">
        light_mode
      </span>
      <span class="material-symbols-outlined theme-icon-dark" aria-hidden="true">
        dark_mode
      </span>
    </button>
  );
}

function LocaleToggle({
  t,
  locale,
  pathname,
}: {
  t: TranslateFn;
  locale: Locale;
  pathname: string;
}) {
  const label = t('action.switchLanguage');
  return (
    <div class="dropdown" data-dropdown>
      <button
        type="button"
        class="btn-icon"
        data-dropdown-toggle
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded="false"
      >
        <span class="material-symbols-outlined" aria-hidden="true">
          language
        </span>
      </button>
      <div class="dropdown-menu" data-dropdown-menu role="menu">
        {LOCALES.map((code) => {
          const href = `/language/${code}?next=${encodeURIComponent(pathname || '/')}`;
          const active = code === locale;
          return (
            <a
              key={code}
              href={href}
              role="menuitem"
              aria-current={active ? 'true' : undefined}
              class={`flex items-center justify-between rounded-lg px-3 py-2 text-sm transition ${active
                ? 'bg-primary/10 font-semibold text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
            >
              <span>{code === 'zh' ? '中文' : 'English'}</span>
              {active ? (
                <span class="material-symbols-outlined icon-sm" aria-hidden="true">
                  check
                </span>
              ) : null}
            </a>
          );
        })}
      </div>
    </div>
  );
}

export function Layout({
  title,
  description,
  appName,
  faviconUrl,
  logoUrl,
  currentUser,
  csrfToken,
  robots,
  canonical,
  shell = 'page',
  nonce,
  t,
  locale,
  pathname,
  isAdmin,
  customCss,
  customJs,
  customFooter,
  og,
  children,
}: PropsWithChildren<LayoutProps>) {
  const pageTitle = title ? `${title} · ${appName}` : appName;

  return (
    <html lang={htmlLang(locale)} class="h-full">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: NAV_SCRIPT }} />
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: REPEATER_SCRIPT }} />
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: DROPDOWN_SCRIPT }} />
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: TAG_AUTOCOMPLETE_SCRIPT }} />
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: TAG_HIDDEN_SCRIPT }} />
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: GRAVATAR_SCRIPT }} />
        <title>{pageTitle}</title>
        {faviconUrl && isSafeFaviconUrl(faviconUrl) ? <link rel="icon" href={faviconUrl} /> : null}
        <meta name="description" content={description ?? t('meta.defaultDescription')} />
        {robots ? <meta name="robots" content={robots} /> : null}
        {canonical ? <link rel="canonical" href={canonical} /> : null}
        {og ? (
          <>
            <meta property="og:type" content={og.type ?? 'profile'} />
            <meta property="og:title" content={og.title} />
            <meta property="og:description" content={og.description} />
            <meta property="og:url" content={og.url} />
            {og.image ? <meta property="og:image" content={og.image} /> : null}
            <meta name="twitter:card" content={og.image ? 'summary_large_image' : 'summary'} />
          </>
        ) : null}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Quicksand:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0&display=block"
        />
        <link rel="stylesheet" href="/styles.css" />
        <script src="/vendor/htmx.min.js" defer />
        {customCss ? (
          <style data-custom-code dangerouslySetInnerHTML={{ __html: rawInlineBlock(customCss, 'style') }} />
        ) : null}
      </head>
      <body class="h-full">
        {shell === 'console' ? (
          <ConsoleShell
            appName={appName}
            logoUrl={logoUrl}
            title={title}
            currentUser={currentUser}
            csrfToken={csrfToken}
            t={t}
            locale={locale}
            pathname={pathname}
            isAdmin={isAdmin}
            customFooter={customFooter}
          >
            {children}
          </ConsoleShell>
        ) : (
          <PageShell
            appName={appName}
            logoUrl={logoUrl}
            currentUser={currentUser}
            csrfToken={csrfToken}
            t={t}
            locale={locale}
            pathname={pathname}
            customFooter={customFooter}
          >
            {children}
          </PageShell>
        )}
        {customJs ? (
          <script nonce={nonce} data-custom-code dangerouslySetInnerHTML={{ __html: rawInlineBlock(customJs, 'script') }} />
        ) : null}
      </body>
    </html>
  );
}

function UserMenu({
  currentUser,
  csrfToken,
  t,
}: {
  currentUser?: LayoutProps['currentUser'];
  csrfToken?: string;
  t: TranslateFn;
}) {
  if (!currentUser) {
    return (
      <a href="/login" class="btn-primary px-4 py-2">
        {t('nav.signIn')}
      </a>
    );
  }
  return (
    <form method="post" action="/auth/logout" class="contents">
      {csrfToken ? <input type="hidden" name="_csrf" value={csrfToken} /> : null}
      <button type="submit" class="btn-ghost text-muted-foreground">
        {t('nav.signOut')}
      </button>
    </form>
  );
}

function PageShell({
  appName,
  logoUrl,
  currentUser,
  csrfToken,
  t,
  locale,
  pathname,
  customFooter,
  children,
}: PropsWithChildren<{
  appName: string;
  logoUrl?: string;
  currentUser?: LayoutProps['currentUser'];
  csrfToken?: string;
  t: TranslateFn;
  locale: Locale;
  pathname: string;
  customFooter?: string;
}>) {
  return (
    <div class="flex min-h-full flex-col">
      <header class="sticky top-0 z-30 border-b border-border/60 bg-background/70 backdrop-blur-xl">
        <div class="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-4">
          <Logo appName={appName} logoUrl={logoUrl} hideTextOnMobile />
          <nav class="flex items-center gap-1 text-sm">
            {currentUser?.username ? (
              <a class="hidden text-muted-foreground transition hover:text-foreground sm:inline-flex" href={`/${currentUser.username}`}>
                @{currentUser.username}
              </a>
            ) : null}
            <LocaleToggle t={t} locale={locale} pathname={pathname} />
            <ThemeToggle t={t} />
            <a
              class="btn-icon"
              href={GITHUB_REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub"
              title="GitHub"
            >
              <span class="material-symbols-outlined" aria-hidden="true">
                code
              </span>
            </a>
            {currentUser ? (
              <>
                <span class="mx-1 hidden h-4 w-px bg-border sm:inline-block" aria-hidden="true" />
                <a class="btn-ghost" href="/dashboard">
                  {t('nav.dashboard')}
                </a>
              </>
            ) : null}
            <UserMenu currentUser={currentUser} csrfToken={csrfToken} t={t} />
          </nav>
        </div>
      </header>

      <main class="flex-1 px-4 py-10">
        <div class="mx-auto w-full max-w-5xl">{children}</div>
      </main>

      {customFooter ? (
        <footer
          data-custom-footer
          class="border-t border-border/60 py-6 text-center text-xs text-muted-foreground"
          dangerouslySetInnerHTML={{ __html: customFooter }}
        />
      ) : (
        <footer class="border-t border-border/60 py-6 text-center text-xs text-muted-foreground">
          <a
            class="font-semibold text-foreground/80 transition hover:text-foreground hover:underline"
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            {appName}
          </a>
          <span class="mx-1.5 opacity-60">·</span>
          {t('footer.tagline')}
        </footer>
      )}
    </div>
  );
}

function ConsoleShell({
  appName,
  logoUrl,
  title,
  currentUser,
  csrfToken,
  t,
  locale,
  pathname,
  isAdmin,
  customFooter,
  children,
}: PropsWithChildren<{
  appName: string;
  logoUrl?: string;
  title?: string;
  currentUser?: LayoutProps['currentUser'];
  csrfToken?: string;
  t: TranslateFn;
  locale: Locale;
  pathname: string;
  isAdmin?: boolean;
  customFooter?: string;
}>) {
  const username = currentUser?.username ?? '';
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const navItem = (active: boolean) =>
    `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${active
      ? 'bg-primary/10 font-semibold text-primary ring-1 ring-inset ring-primary/20'
      : 'font-medium text-muted-foreground hover:bg-muted hover:text-foreground'
    }`;
  return (
    <div class="flex min-h-screen" id="console-shell">
      <div
        data-nav-close="true"
        class="console-backdrop fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity duration-200"
        aria-hidden="true"
      />

      <aside
        id="mobile-nav"
        class="console-nav fixed inset-y-0 left-0 z-50 flex w-72 shrink-0 flex-col border-r border-border bg-card shadow-pop transition-transform duration-200 lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:shadow-none"
      >
        <div class="flex h-16 items-center justify-between px-5">
          <Logo appName={appName} logoUrl={logoUrl} />
          <button
            type="button"
            class="btn-icon lg:hidden"
            data-nav-close="true"
            aria-label={t('action.closeMenu')}
          >
            <span class="material-symbols-outlined" aria-hidden="true">
              close
            </span>
          </button>
        </div>

        <nav class="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          <p class="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('nav.workspace')}
          </p>
          <a href="/dashboard" class={navItem(isActive('/dashboard'))}>
            <span class="material-symbols-outlined" aria-hidden="true">
              dashboard
            </span>
            {t('nav.dashboard')}
          </a>
          {isAdmin ? (
            <a href="/admin" class={navItem(isActive('/admin'))}>
              <span class="material-symbols-outlined" aria-hidden="true">
                admin_panel_settings
              </span>
              {t('admin.nav')}
            </a>
          ) : null}
          {username ? (
            <a href={`/${username}`} class={navItem(isActive(`/${username}`))}>
              <span class="material-symbols-outlined" aria-hidden="true">
                person
              </span>
              {t('nav.publicProfile')}
            </a>
          ) : null}

          {username ? (
            <>
              <p class="px-3 pb-1 pt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t('nav.profile')}
              </p>
              <div class="flex items-center gap-3 rounded-xl px-3 py-2.5">
                <span class="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-primary to-secondary text-xs font-bold text-primary-foreground">
                  {username.slice(0, 2).toUpperCase()}
                </span>
                <div class="min-w-0">
                  <p class="truncate text-sm font-semibold">{currentUser?.displayName || username}</p>
                  <p class="truncate text-xs text-muted-foreground">@{username}</p>
                </div>
              </div>
            </>
          ) : null}
        </nav>

        <div class="border-t border-border p-3">
          <div class="flex items-center justify-end px-1 py-1">
            <UserMenu currentUser={currentUser} csrfToken={csrfToken} t={t} />
          </div>
        </div>
      </aside>

      <div class="flex min-w-0 flex-1 flex-col">
        <header class="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/70 px-4 backdrop-blur-xl lg:px-8">
          <button
            type="button"
            class="btn-icon lg:hidden"
            data-nav-open="true"
            aria-label={t('action.openMenu')}
          >
            <span class="material-symbols-outlined" aria-hidden="true">
              menu
            </span>
          </button>
          <h1 class="truncate text-lg font-bold tracking-tight">{title ?? appName}</h1>
          <div class="ml-auto flex items-center gap-2">
            <LocaleToggle t={t} locale={locale} pathname={pathname} />
            <ThemeToggle t={t} />
            {username ? (
              <a href={`/${username}`} class="btn-outline">
                {t('nav.viewProfile')}
              </a>
            ) : null}
          </div>
        </header>

        <main class="flex-1 px-4 py-6 lg:px-8 lg:py-8">
          <div class="mx-auto w-full max-w-4xl">{children}</div>
        </main>

        {customFooter ? (
          <footer
            data-custom-footer
            class="border-t border-border/60 px-4 py-6 text-center text-xs text-muted-foreground lg:px-8"
            dangerouslySetInnerHTML={{ __html: customFooter }}
          />
        ) : null}
      </div>
    </div>
  );
}
