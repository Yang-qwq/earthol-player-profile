import { parse } from 'mfm-js';
import type { MfmFn, MfmNode } from 'mfm-js';
import type { Locale } from '../i18n';

/**
 * Local MFM → HTML integrator for user-authored MFM fields (profile bio and
 * text-block bodies).
 *
 * `mfm-js` only produces an AST, so this module owns the (whitelisted) HTML it
 * emits: every text run is escaped, URLs must parse as http(s), and `$[...]`
 * functions only contribute styling from a fixed allow-list. Never feed the
 * result to `dangerouslySetInnerHTML` with a looser renderer.
 *
 * Supported `$[...]` functions mirror Misskey's MFM reference
 * (https://misskey-hub.net/cn/docs/for-users/features/mfm/): ruby, unixtime,
 * flip, font, blur, fg/bg color, border, rotate, position, scale (x2/x3/x4),
 * the animation family (jelly, tada, jump, bounce, spin, shake, twitch,
 * rainbow, sparkle — plus the legacy blink/twinkle/flicker), fontSize, and
 * plain/colour aliases. Numeric arguments are range-clamped and string ones
 * are checked against an allow-list, so a hostile post can only ever produce
 * in-range inline styles.
 */

const NEST_LIMIT = 24;

const ANIMATIONS = new Set([
  'tada',
  'jelly',
  'spin',
  'jump',
  'bounce',
  'blink',
  'twinkle',
  'shake',
  'twitch',
  'rainbow',
  'sparkle',
  'flicker',
]);

const POSITIONS = new Set(['left', 'right', 'center']);

const FONT_FAMILIES = new Set(['serif', 'monospace', 'cursive', 'fantasy']);

const BORDER_STYLES = new Set([
  'solid',
  'dashed',
  'dotted',
  'double',
  'groove',
  'ridge',
  'inset',
  'outset',
  'hidden',
  'none',
]);

const COLOR_KEYWORDS = new Set([
  'black',
  'silver',
  'gray',
  'grey',
  'white',
  'maroon',
  'red',
  'purple',
  'fuchsia',
  'green',
  'lime',
  'olive',
  'yellow',
  'navy',
  'blue',
  'teal',
  'aqua',
  'orange',
  'pink',
  'gold',
  'indigo',
  'violet',
  'turquoise',
  'coral',
  'salmon',
  'khaki',
  'beige',
  'ivory',
  'crimson',
  'magenta',
  'cyan',
  'transparent',
]);

// Misskey accepts 3/4/6/8 digit hex (with or without a leading `#`).
const HEX_COLOR = /^[0-9a-f]{3,4}$|^[0-9a-f]{6}$|^[0-9a-f]{8}$/i;
const FONT_SIZE = /^\d+(?:\.\d+)?(?:em|rem|px|%)$/;
const DURATION = /^(\d+(?:\.\d+)?)(ms|s)$/;
const SCALE_ALIAS = /^x(\d+(?:\.\d+)?)$/;
const BLOCK_TAG = /(?:<br\/>)+(<(?:blockquote|pre|div|form)\b)/g;
const BLOCK_TAIL = /(<\/(?:blockquote|pre|div|form)>)(?:<br\/>)+/g;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function textHtml(value: string): string {
  return escapeHtml(value).replace(/\r\n?|\n/g, '<br/>');
}

function safeHref(value: string): string | null {
  const candidate = value.trim().replace(/[\u0000-\u0020<>"]/g, '');
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

function safeColor(value: string | undefined): string | null {
  const color = (value ?? '').trim().toLowerCase();
  if (!color) return null;
  if (COLOR_KEYWORDS.has(color)) return color;
  const hex = color.startsWith('#') ? color.slice(1) : color;
  return HEX_COLOR.test(hex) ? `#${hex}` : null;
}

/** Reads a finite number from an arg and clamps it into `[min, max]`. */
function clampedNumber(value: string | true | undefined, min: number, max: number): number | null {
  if (value === undefined || value === true) return null;
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed)) return null;
  return Math.max(min, Math.min(max, parsed));
}

/** `speed=` accepts seconds or milliseconds; anything outside 0.05–20s is refused. */
function safeDuration(value: string | true | undefined): string | null {
  if (value === undefined || value === true) return null;
  const match = value.trim().match(DURATION);
  if (!match) return null;
  const amount = Number(match[1]);
  const ms = match[2] === 's' ? amount * 1000 : amount;
  if (!Number.isFinite(ms) || ms < 50 || ms > 20000) return null;
  return `${Math.round(ms)}ms`;
}

function formatNumber(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

function externalLink(href: string, label: string): string {
  return `<a class="mfm-link" href="${escapeHtml(href)}" rel="nofollow noopener noreferrer" target="_blank">${label}</a>`;
}

function firstBareArg(args: MfmFn['props']['args']): string {
  for (const [key, value] of Object.entries(args)) {
    if (value === true) return key;
  }
  return '';
}

/** mfm-js spells positional args as bare flags (`$[color.red …]` → `{ red: true }`). */
function argValue(args: MfmFn['props']['args'], names: string[]): string | null {
  for (const name of names) {
    const value = args[name];
    if (typeof value === 'string') return value;
  }
  return firstBareArg(args) || null;
}

/**
 * Flattens a node list to plain text. Used by `ruby` and `unixtime`, whose
 * arguments are plain text even though mfm-js hands them over as children.
 */
function plainText(nodes: readonly MfmNode[]): string {
  let out = '';
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        out += node.props.text;
        break;
      case 'unicodeEmoji':
        out += node.props.emoji;
        break;
      case 'emojiCode':
        out += `:${node.props.name}:`;
        break;
      case 'plain':
      case 'bold':
      case 'small':
      case 'italic':
      case 'strike':
      case 'link':
      case 'fn':
        out += plainText(node.children);
        break;
      case 'center':
        out += plainText(node.children);
        break;
      default:
        break;
    }
  }
  return out;
}

function fnClass(name: string, args: MfmFn['props']['args']): string | null {
  if (ANIMATIONS.has(name)) {
    if (name === 'spin') {
      const axis = args['x'] === true ? '-x' : args['y'] === true ? '-y' : '';
      return `mfm-anim mfm-anim-spin${axis}`;
    }
    return `mfm-anim mfm-anim-${name}`;
  }
  if (name === 'position') {
    const named = String(args['position'] ?? '')
      .trim()
      .toLowerCase();
    const bare = firstBareArg(args).toLowerCase();
    const value = POSITIONS.has(named) ? named : POSITIONS.has(bare) ? bare : '';
    return value ? `mfm-pos-${value}` : null;
  }
  if (name === 'flip') {
    const h = args['h'] === true;
    const v = args['v'] === true;
    return h && v ? 'mfm-flip-hv' : v ? 'mfm-flip-v' : 'mfm-flip-h';
  }
  if (name === 'font') {
    const family = firstBareArg(args).toLowerCase();
    return FONT_FAMILIES.has(family) ? `mfm-font-${family}` : null;
  }
  if (name === 'blur') return 'mfm-blur';
  if (name === 'border') return 'mfm-border';
  return null;
}

function fnStyle(name: string, args: MfmFn['props']['args']): string | null {
  if (name === 'color' || name === 'colour' || name === 'fg') {
    const color = safeColor(argValue(args, ['color', 'colour', 'fg']) ?? '');
    return color ? `color:${color}` : null;
  }
  if (name === 'backgroundColor' || name === 'bg') {
    const color = safeColor(argValue(args, ['color', 'backgroundColor', 'bg']) ?? '');
    return color ? `background-color:${color}` : null;
  }
  if (name === 'fontSize') {
    const size = (argValue(args, ['fontSize']) ?? '').trim();
    return FONT_SIZE.test(size) ? `font-size:${size}` : null;
  }
  if (name === 'rotate') {
    const deg = clampedNumber(args['deg'], -360, 360);
    if (deg === null) return null;
    return `display:inline-block;transform:rotate(${formatNumber(deg)}deg)`;
  }
  if (name === 'scale') {
    const x = clampedNumber(args['x'], 0.1, 10) ?? 1;
    const y = clampedNumber(args['y'], 0.1, 10) ?? 1;
    return `display:inline-block;transform:scale(${formatNumber(x)},${formatNumber(y)})`;
  }
  const scaleAlias = name.match(SCALE_ALIAS);
  if (scaleAlias) {
    const factor = clampedNumber(scaleAlias[1], 0.1, 10);
    if (factor === null) return null;
    return `display:inline-block;transform:scale(${formatNumber(factor)})`;
  }
  if (name === 'position') {
    const x = clampedNumber(args['x'], -100, 100);
    const y = clampedNumber(args['y'], -100, 100);
    if (x === null && y === null) return null;
    return `display:inline-block;transform:translate(${formatNumber(x ?? 0)}em,${formatNumber(y ?? 0)}em)`;
  }
  if (name === 'border') {
    const style = String(args['style'] ?? 'solid')
      .trim()
      .toLowerCase();
    const width = clampedNumber(args['width'], 0, 32) ?? 1;
    const radius = clampedNumber(args['radius'], 0, 200);
    const color = safeColor(typeof args['color'] === 'string' ? args['color'] : '') ?? 'currentColor';
    const decls = [
      `border:${formatNumber(width)}px ${BORDER_STYLES.has(style) ? style : 'solid'} ${color}`,
      'padding:0.05em 0.2em',
    ];
    if (radius !== null) decls.push(`border-radius:${formatNumber(radius)}px`);
    // Misskey clips overflowing positioned children unless `noclip` is set.
    decls.push(args['noclip'] === true ? 'overflow:visible' : 'overflow:hidden');
    return decls.join(';');
  }
  if (ANIMATIONS.has(name)) {
    const decls: string[] = [];
    const duration = safeDuration(args['speed']);
    if (duration) decls.push(`animation-duration:${duration}`);
    if (name === 'spin') {
      const direction =
        args['left'] === true ? 'reverse' : args['alternate'] === true ? 'alternate' : null;
      if (direction) decls.push(`animation-direction:${direction}`);
    }
    return decls.length > 0 ? decls.join(';') : null;
  }
  return null;
}

/** `$[ruby base reading]` → `<ruby>base<rt>reading</rt></ruby>`. */
function renderRuby(children: readonly MfmNode[]): string {
  const text = plainText(children).trim();
  if (!text) return '';
  const match = text.match(/^(\S+)(?:\s+([\s\S]+))?$/);
  if (!match) return escapeHtml(text);
  const [, base, reading] = match;
  if (!reading) return escapeHtml(base);
  return `<ruby class="mfm-ruby">${escapeHtml(base)}<rt>${escapeHtml(reading)}</rt></ruby>`;
}

/** `$[unixtime 1701356400]` → a `<time>` element rendered in the request locale. */
function renderUnixtime(children: readonly MfmNode[], locale: Locale): string {
  const raw = plainText(children).trim();
  const seconds = Number(raw);
  const date = new Date(seconds * 1000);
  if (!raw || !Number.isFinite(seconds) || Number.isNaN(date.getTime())) return escapeHtml(raw);
  const label = formatDateTime(date, locale);
  return `<time class="mfm-unixtime" datetime="${date.toISOString()}" title="${date.toISOString()}">${escapeHtml(label)}</time>`;
}

function formatDateTime(date: Date, locale: Locale): string {
  // UTC keeps the rendered string independent of the Worker's clock settings,
  // which matters because anonymous profile HTML is cached verbatim.
  const tag = locale === 'zh' ? 'zh-CN' : 'en-US';
  try {
    return new Intl.DateTimeFormat(tag, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(date);
  } catch {
    return date.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
  }
}

function renderNodes(nodes: readonly MfmNode[], locale: Locale): string {
  return nodes.map((node) => renderNode(node, locale)).join('');
}

function renderNode(node: MfmNode, locale: Locale): string {
  switch (node.type) {
    case 'plain':
      return renderNodes(node.children, locale);
    case 'text':
      return textHtml(node.props.text);
    case 'unicodeEmoji':
      return `<span class="mfm-unicode-emoji">${escapeHtml(node.props.emoji)}</span>`;
    case 'emojiCode':
      return `<span class="mfm-emoji-code">:${escapeHtml(node.props.name)}:</span>`;
    case 'bold':
      return `<strong>${renderNodes(node.children, locale)}</strong>`;
    case 'small':
      return `<small>${renderNodes(node.children, locale)}</small>`;
    case 'italic':
      return `<em>${renderNodes(node.children, locale)}</em>`;
    case 'strike':
      return `<del>${renderNodes(node.children, locale)}</del>`;
    case 'inlineCode':
      return `<code class="mfm-inline-code">${escapeHtml(node.props.code)}</code>`;
    case 'mathInline':
      return `<code class="mfm-math">${escapeHtml(node.props.formula)}</code>`;
    case 'mention': {
      // mfm-js already includes the leading `@` in `acct`.
      const label = escapeHtml(node.props.acct);
      if (node.props.host) return `<span class="mfm-mention">${label}</span>`;
      return `<a class="mfm-mention" href="/${encodeURIComponent(node.props.username.toLowerCase())}">${label}</a>`;
    }
    case 'hashtag':
      return `<span class="mfm-hashtag">#${escapeHtml(node.props.hashtag)}</span>`;
    case 'url': {
      const href = safeHref(node.props.url);
      const label = escapeHtml(node.props.url.replace(/^\[|\]$/g, ''));
      if (!href) return label;
      return externalLink(href, label);
    }
    case 'link': {
      const label = renderNodes(node.children, locale);
      const href = safeHref(node.props.url);
      if (!href) return label;
      return externalLink(href, label);
    }
    case 'fn': {
      const { name, args } = node.props;
      if (name === 'ruby') return renderRuby(node.children);
      if (name === 'unixtime') return renderUnixtime(node.children, locale);
      const children = renderNodes(node.children, locale);
      const className = fnClass(name, args);
      const style = fnStyle(name, args);
      if (!className && !style) return children;
      const attrs = [className ? ` class="${className}"` : '', style ? ` style="${escapeHtml(style)}"` : ''].join(
        '',
      );
      return `<span${attrs}>${children}</span>`;
    }
    case 'quote':
      return `<blockquote class="mfm-quote">${renderNodes(node.children, locale)}</blockquote>`;
    case 'search': {
      const query = escapeHtml(node.props.query);
      return `<form class="mfm-search" action="https://www.google.com/search" method="get" target="_blank" rel="noopener noreferrer"><input class="mfm-search-input" type="search" name="q" value="${query}" aria-label="Search" autocomplete="off"/></form>`;
    }
    case 'blockCode': {
      const lang = node.props.lang ? ` data-lang="${escapeHtml(node.props.lang)}"` : '';
      return `<pre class="mfm-code"${lang}><code>${escapeHtml(node.props.code)}</code></pre>`;
    }
    case 'mathBlock':
      return `<pre class="mfm-math">${escapeHtml(node.props.formula)}</pre>`;
    case 'center':
      return `<div class="mfm-center">${renderNodes(node.children, locale)}</div>`;
    default:
      return '';
  }
}

function plainFallback(source: string): string {
  return `<span class="mfm-plain">${textHtml(source)}</span>`;
}

export function renderMfm(source: string, locale: Locale = 'en'): string {
  const input = source.replace(/\r\n?/g, '\n').trim();
  if (!input) return '';

  let nodes: MfmNode[];
  try {
    nodes = parse(input, { nestLimit: NEST_LIMIT });
  } catch {
    return plainFallback(input);
  }

  let html = renderNodes(nodes, locale)
    .replace(BLOCK_TAG, '$1')
    .replace(BLOCK_TAIL, '$1')
    .replace(/^(?:<br\/>)+|(?:<br\/>)+$/g, '');

  if (!html) return plainFallback(input);
  if (!/<(?:blockquote|pre|div|form)\b/.test(html)) html = `<p class="mfm-paragraph">${html}</p>`;
  return html;
}
