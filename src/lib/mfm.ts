import { parse } from 'mfm-js';
import type { MfmFn, MfmNode } from 'mfm-js';

/**
 * Local MFM → HTML integrator for profile bios.
 *
 * `mfm-js` only produces an AST, so this module owns the (whitelisted) HTML it
 * emits: every text run is escaped, URLs must parse as http(s), and `$[...]`
 * functions only contribute styling from a fixed allow-list. Never feed the
 * result to `dangerouslySetInnerHTML` with a looser renderer.
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
  'rainbow',
  'flicker',
]);

const POSITIONS = new Set(['left', 'right', 'center']);

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

const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FONT_SIZE = /^\d+(?:\.\d+)?(?:em|rem|px|%)$/;
const BLOCK_TAG = /(?:<br\/>)+(<(?:blockquote|pre|div)\b)/g;
const BLOCK_TAIL = /(<\/(?:blockquote|pre|div)>)(?:<br\/>)+/g;

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
  if (HEX_COLOR.test(color) || COLOR_KEYWORDS.has(color)) return color;
  return null;
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

function fnClass(name: string, args: MfmFn['props']['args']): string | null {
  if (ANIMATIONS.has(name)) return `mfm-anim mfm-anim-${name}`;
  if (name === 'position') {
    const named = String(args['position'] ?? '').trim().toLowerCase();
    const bare = firstBareArg(args).toLowerCase();
    const value = POSITIONS.has(named) ? named : POSITIONS.has(bare) ? bare : '';
    return value ? `mfm-pos-${value}` : null;
  }
  return null;
}

function fnStyle(name: string, args: MfmFn['props']['args']): string | null {
  if (name === 'color' || name === 'colour') {
    const color = safeColor(argValue(args, ['color', 'colour']) ?? '');
    return color ? `color:${color}` : null;
  }
  if (name === 'backgroundColor' || name === 'bg') {
    const color = safeColor(argValue(args, [name]) ?? '');
    return color ? `background-color:${color}` : null;
  }
  if (name === 'fontSize') {
    const size = (argValue(args, ['fontSize']) ?? '').trim();
    return FONT_SIZE.test(size) ? `font-size:${size}` : null;
  }
  return null;
}

function renderNodes(nodes: readonly MfmNode[]): string {
  return nodes.map(renderNode).join('');
}

function renderNode(node: MfmNode): string {
  switch (node.type) {
    case 'plain':
      return renderNodes(node.children);
    case 'text':
      return textHtml(node.props.text);
    case 'unicodeEmoji':
      return `<span class="mfm-unicode-emoji">${escapeHtml(node.props.emoji)}</span>`;
    case 'emojiCode':
      return `<span class="mfm-emoji-code">:${escapeHtml(node.props.name)}:</span>`;
    case 'bold':
      return `<strong>${renderNodes(node.children)}</strong>`;
    case 'small':
      return `<small>${renderNodes(node.children)}</small>`;
    case 'italic':
      return `<em>${renderNodes(node.children)}</em>`;
    case 'strike':
      return `<del>${renderNodes(node.children)}</del>`;
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
      const label = renderNodes(node.children);
      const href = safeHref(node.props.url);
      if (!href) return label;
      return externalLink(href, label);
    }
    case 'fn': {
      const children = renderNodes(node.children);
      const className = fnClass(node.props.name, node.props.args);
      const style = fnStyle(node.props.name, node.props.args);
      if (!className && !style) return children;
      const attrs = [className ? ` class="${className}"` : '', style ? ` style="${escapeHtml(style)}"` : ''].join(
        '',
      );
      return `<span${attrs}>${children}</span>`;
    }
    case 'quote':
      return `<blockquote class="mfm-quote">${renderNodes(node.children)}</blockquote>`;
    case 'search':
      return `<div class="mfm-search">${textHtml(node.props.query)}</div>`;
    case 'blockCode': {
      const lang = node.props.lang ? ` data-lang="${escapeHtml(node.props.lang)}"` : '';
      return `<pre class="mfm-code"${lang}><code>${escapeHtml(node.props.code)}</code></pre>`;
    }
    case 'mathBlock':
      return `<pre class="mfm-math">${escapeHtml(node.props.formula)}</pre>`;
    case 'center':
      return `<div class="mfm-center">${renderNodes(node.children)}</div>`;
    default:
      return '';
  }
}

function plainFallback(source: string): string {
  return `<span class="mfm-plain">${textHtml(source)}</span>`;
}

export function renderMfmBio(source: string): string {
  const input = source.replace(/\r\n?/g, '\n').trim();
  if (!input) return '';

  let nodes: MfmNode[];
  try {
    nodes = parse(input, { nestLimit: NEST_LIMIT });
  } catch {
    return plainFallback(input);
  }

  let html = renderNodes(nodes)
    .replace(BLOCK_TAG, '$1')
    .replace(BLOCK_TAIL, '$1')
    .replace(/^(?:<br\/>)+|(?:<br\/>)+$/g, '');

  if (!html) return plainFallback(input);
  if (!/<(?:blockquote|pre|div)\b/.test(html)) html = `<p class="mfm-paragraph">${html}</p>`;
  return html;
}
