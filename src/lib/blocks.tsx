/**
 * Server-side rendering of profile blocks — the single place a `ProfileBlockRow`
 * becomes markup on the public profile.
 *
 * Security posture (deliberate):
 * - Text-block bodies are **user-authored MFM**, rendered through the same
 *   whitelisted integrator as the bio (`renderMfm` in `src/lib/mfm.ts`): every
 *   text run is escaped, links only survive as http(s), and `$[...]` functions
 *   only contribute classes/styles from its fixed allow-list. A body that
 *   fails to parse falls back to escaped plain text inside the integrator, so
 *   nothing user-authored reaches the DOM unescaped. Do not bypass the
 *   integrator with a looser renderer.
 * - Gallery `items` is a stored JSON array of arbitrary user strings. It is
 *   parsed defensively (a non-array or unparsable value yields no items) and
 *   an item only ever becomes an `<img src>` when it passes `isSafeUrl`, the
 *   same check the fields feature uses. Anything that fails is dropped from
 *   the DOM entirely — it is never emitted into an attribute, so a
 *   `javascript:` URL or a `" onerror="…` payload cannot reach the markup.
 *
 * Audience filtering lives in `src/lib/audience.ts`; this module only renders
 * rows a caller has already decided to show.
 */
import type { BlockKind, BlockVisibility, ProfileBlockRow } from '../db/types';
import {
  AUDIENCES,
  conditionsOfRow,
  isBlockVisibility,
  isViewerIndependent,
  type BlockViewerLists,
} from './audience';
import { renderMfm } from './mfm';
import { isStoredPath } from './storage';
import { isSafeUrl } from './validate';
import type { TranslateFn } from '../i18n';

/**
 * Parses a gallery block's stored `items` (a JSON array string) into the list
 * of image URLs that may be rendered. Returns `[]` for anything that is not a
 * JSON array of strings — a malformed stored value renders nothing rather
 * than throwing. Non-string entries are dropped, matching the defensive read.
 */
export function parseGalleryItems(items: string | null): string[] {
  if (!items) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(items);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((entry): entry is string => typeof entry === 'string');
}

/**
 * The audiences available in the dashboard editor, with their i18n labels.
 * Source: `AUDIENCES` — never a hand-written copy, so a new audience can only
 * be added in one place (`src/lib/audience.ts`).
 */
export function audienceOptions(t: TranslateFn): { value: BlockVisibility; label: string }[] {
  return AUDIENCES.map((value) => ({ value, label: t(`block.audience.${value}`) }));
}

/** i18n label for a block kind. */
export function blockKindLabel(kind: BlockKind, t: TranslateFn): string {
  return t(`block.kind.${kind}`);
}

/**
 * Narrows a D1 row's `kind` to `BlockKind`. D1 rows are untyped at the
 * boundary, so anything other than the two known literals is `null` and the
 * row renders nothing (fail closed, mirroring `isBlockVisibility`).
 */
function blockKindOf(row: ProfileBlockRow): BlockKind | null {
  return row.kind === 'text' || row.kind === 'gallery' ? row.kind : null;
}

/**
 * The rows that may be baked into the **shared** anonymous profile cache
 * (`profile:html:<locale>:<username>`, one copy served to every anonymous
 * visitor for 300s). This is the cache contract made explicit rather than
 * incidental: only blocks whose visibility and conditions are *provably*
 * viewer- and time-independent — `isViewerIndependent` is true only for a
 * `public` block with no conditions at all — may enter that HTML, so a future
 * change to `canViewBlock` can never silently poison the shared copy. Filter
 * here even though anonymous viewers would fail the other audiences today.
 *
 * The allow/deny lists live in a child table, so the caller passes the grouped
 * map in; a block with any listed user is viewer-dependent and is filtered out.
 * The result is derived from the profiled user's rows only — never from the
 * viewer, which does not exist on this path.
 */
export function cacheableBlocks(
  rows: readonly ProfileBlockRow[],
  viewers: ReadonlyMap<string, BlockViewerLists> = new Map(),
): ProfileBlockRow[] {
  return rows.filter((row) => {
    const visibility = isBlockVisibility(row.visibility) ? row.visibility : null;
    if (visibility === null) return false;
    // Tags, user lists, age gates, and a time window all vary by viewer or time,
    // so any of them keeps the block out of the shared anonymous copy.
    return isViewerIndependent(visibility, conditionsOfRow(row, viewers.get(row.id)));
  });
}

/**
 * One profile block as a **standalone card**. The profile composes these (and
 * the key/value fields card) into an ordered list, so this component owns only
 * a single block's markup — never a wrapping section. Returns `null` when the
 * row's kind is unusable. `isOwner` adds the audience marker so owners can tell
 * what other viewers cannot see.
 */
export function ProfileBlockCard(props: {
  row: ProfileBlockRow;
  isOwner: boolean;
  viewers?: ReadonlyMap<string, BlockViewerLists>;
  t: TranslateFn;
}) {
  const { row, isOwner, viewers, t } = props;
  const kind = blockKindOf(row);
  if (kind === null) return null;

  return (
    <div class="card p-5" data-block>
      {row.title ? <h3 class="break-words text-sm font-bold tracking-tight">{row.title}</h3> : null}
      {kind === 'text' ? (
        row.body ? (
          <div
            class="mfm-body mt-1 break-words text-sm leading-relaxed text-foreground/85"
            data-block-body
            dangerouslySetInnerHTML={{ __html: renderMfm(row.body) }}
          />
        ) : null
      ) : (
        <GalleryGrid items={parseGalleryItems(row.items)} />
      )}
      {isOwner ? <BlockAudienceMarker row={row} lists={viewers?.get(row.id)} t={t} /> : null}
    </div>
  );
}

/**
 * Lays out a gallery's renderable images. An item is emitted only when it is
 * either an absolute http(s) URL (`isSafeUrl`) or one of this app's own
 * stored paths (`isStoredPath` — the strict `/files/(avatars|gallery)/…` key
 * regex, so arbitrary relative or protocol-relative paths still fail closed).
 * `isSafeUrl` alone rejects same-origin relative paths (`new URL` throws
 * without a base), which would have made R2 gallery uploads invisible; the
 * avatar column has the same shape and is rendered without any URL check, so
 * trusting the exact stored-path form is consistent with the app's model
 * (only this Worker's own writes produce such paths).
 */
function GalleryGrid(props: { items: readonly string[] }) {
  const { items } = props;
  if (items.length === 0) return null;
  return (
    <div class="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3" data-block-gallery>
      {items.map((item, index) =>
        isSafeUrl(item) || isStoredPath(item) ? (
          <img
            key={index}
            src={item}
            alt=""
            loading="lazy"
            class="aspect-square w-full rounded-xl bg-card object-cover ring-1 ring-inset ring-border"
          />
        ) : null,
      )}
    </div>
  );
}

/**
 * Owner-only marker naming the block's audience and any refining conditions
 * (mirrors the hidden-tag icon). A block with a condition is no longer plain
 * `public`, so it gets the "lock" glyph even when its base audience is public.
 */
function BlockAudienceMarker(props: {
  row: ProfileBlockRow;
  lists?: BlockViewerLists;
  t: TranslateFn;
}) {
  const { row, lists, t } = props;
  const visibility = isBlockVisibility(row.visibility) ? row.visibility : null;
  if (visibility === null) return null;
  const conditions = conditionsOfRow(row, lists);
  const extra: { key: string; label: string }[] = [];
  if (conditions.relation !== null) {
    extra.push({ key: 'relation', label: t(`block.relation.${conditions.relation}`) });
  }
  if (conditions.requiredTags.length > 0) {
    extra.push({
      key: 'tags',
      label: t(
        conditions.tagMatch === 'all' ? 'block_marker.requiredTagsAll' : 'block_marker.requiredTagsAny',
        { tags: conditions.requiredTags.join(', ') },
      ),
    });
  }
  if (conditions.excludedTags.length > 0) {
    extra.push({
      key: 'excluded',
      label: t('block_marker.excludedTags', { tags: conditions.excludedTags.join(', ') }),
    });
  }
  if (conditions.allowUserIds.length > 0) {
    extra.push({
      key: 'allow',
      label: t('block_marker.allowUsers', { count: String(conditions.allowUserIds.length) }),
    });
  }
  if (conditions.denyUserIds.length > 0) {
    extra.push({
      key: 'deny',
      label: t('block_marker.denyUsers', { count: String(conditions.denyUserIds.length) }),
    });
  }
  if (conditions.minFollowDays !== null) {
    extra.push({
      key: 'days',
      label: t('block_marker.minFollowDays', { days: String(conditions.minFollowDays) }),
    });
  }
  if (conditions.minAccountAgeDays !== null) {
    extra.push({
      key: 'age',
      label: t('block_marker.minAccountAgeDays', { days: String(conditions.minAccountAgeDays) }),
    });
  }
  if (conditions.visibleFrom !== null || conditions.visibleUntil !== null) {
    extra.push({ key: 'window', label: t('block_marker.window') });
  }
  return (
    <p class="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground" data-block-audience>
      <span class="material-symbols-outlined icon-xs" aria-hidden="true">
        {visibility === 'public' && extra.length === 0 ? 'public' : 'lock'}
      </span>
      {t('block_marker.audience', { audience: t(`block.audience.${visibility}`) })}
      {extra.map((part) => (
        <span key={part.key} class="text-foreground/70">
          {part.label}
        </span>
      ))}
    </p>
  );
}
