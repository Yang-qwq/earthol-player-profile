/**
 * Audience predicates for profile blocks. Pure logic — no D1, no KV, no Hono,
 * no views: the question "may this viewer see this block?" is factored out so
 * the routes, the SSR views, and any future tests share exactly one answer.
 *
 * A block carries two things:
 *
 * 1. A single base `visibility` (the *audience*), one of `AUDIENCES`:
 *    `public` (everyone, anonymous included) → `users` (any signed-in account)
 *    → `same_tag` (signed-in *and* sharing at least one tag value with the
 *    owner) → `self` (the owner only). `BlockVisibility` in `src/db/types.ts`
 *    and the `profile_blocks.visibility` CHECK in `schema.sql` must always
 *    agree with `AUDIENCES`; the literals are re-declared there because SQL
 *    cannot import this module. The CHECK is deliberately *not* widened for the
 *    newer rules — that would need a table rebuild, which no migration can do
 *    idempotently (see `migrations/0004_profile_block_rules.sql`).
 *
 * 2. An optional set of *conditions* (`BlockConditions`), all ANDed on top of
 *    the base audience by `canViewBlock`:
 *      - `relation` — a follow-relation requirement (`RELATIONS`: the viewer
 *        follows the owner, the owner follows the viewer, or both). This is
 *        where the relational audiences live, as a condition rather than a
 *        `visibility` literal;
 *      - `requiredTags` (matched `any`/`all`) and `excludedTags` — tag value
 *        tests against the viewer's own tags;
 *      - `allowUserIds` / `denyUserIds` — an explicit per-user allow/deny list
 *        (an allow list, when non-empty, is the "only these people" rule; a
 *        deny list excludes named accounts). This is the non-enumerable way to
 *        target specific people, unlike `same_tag` and `requiredTags`.
 *      - `minFollowDays` / `minAccountAgeDays` — age gates;
 *      - `visibleFrom` / `visibleUntil` — a time window.
 *    Everything is ANDed; there is no top-level OR and no negation beyond the
 *    deny/exclude lists. Each list is an any-of test internally. The missing OR
 *    is a deliberate, recorded trade-off (2026-10): OR under this model needs
 *    grouped/nested conditions, a new storage shape, and a much bigger editor,
 *    owners can approximate it today with duplicate blocks (one per branch) or
 *    the explicit allow list, and no user demand has surfaced — out of scope
 *    short-term; do not add casually.
 *
 * Where a condition (or the audience itself) is answered differently by
 * different viewers, `isViewerIndependent` is false, which keeps the block out
 * of the shared anonymous KV cache — see that function and `cacheableBlocks`
 * in `src/lib/blocks.tsx`.
 *
 * `same_tag`/`requiredTags` are membership oracles by nature (a signed-in
 * viewer can set their own tag values and probe for blocks); that is an
 * accepted trade-off for a user-chosen audience rather than a secrecy
 * primitive. The explicit allow list exists precisely so an owner who wants
 * real secrecy does not have to rely on an enumerable rule.
 */
import type { BlockRelation, BlockVisibility, TagMatch } from '../db/types';

/** Canonical, widest→narrowest list of the audiences. Single source of truth. */
export const AUDIENCES: readonly BlockVisibility[] = ['public', 'users', 'same_tag', 'self'];

const KNOWN_AUDIENCES = new Set<unknown>(AUDIENCES);

/** The follow-relation refinements, as they appear in the dashboard editor. */
export const RELATIONS: readonly BlockRelation[] = ['followers', 'following', 'mutual'];

const KNOWN_RELATIONS = new Set<unknown>(RELATIONS);

/**
 * Strict runtime guard for a `relation` coming from a form body or a D1 row.
 * Rejects non-strings, the empty string, and unknown literals. Callers that
 * only need a safe default (never a widening) should use `relationOf`.
 */
export function isBlockRelation(value: unknown): value is BlockRelation {
  return typeof value === 'string' && KNOWN_RELATIONS.has(value);
}

/** Folds a raw `relation` to the known literal, defaulting to null ("no relation rule"). */
export function relationOf(value: unknown): BlockRelation | null {
  return isBlockRelation(value) ? value : null;
}

/**
 * Strict runtime guard for a visibility coming from a form body, a JSON blob,
 * or a D1 row. Rejects non-strings, the empty string, and unknown literals, so
 * a typo can never reach `canViewBlock` unchallenged.
 */
export function isBlockVisibility(value: unknown): value is BlockVisibility {
  return typeof value === 'string' && KNOWN_AUDIENCES.has(value);
}

const KNOWN_TAG_MATCHES: ReadonlySet<unknown> = new Set(['any', 'all']);

/**
 * Strict runtime guard for a `tag_match` coming from a form body or a D1 row.
 * Callers that only need a safe default (never a widening) should use
 * `tagMatchOf` instead.
 */
export function isTagMatch(value: unknown): value is TagMatch {
  return typeof value === 'string' && KNOWN_TAG_MATCHES.has(value);
}

/** Folds a raw `tag_match` to the known literal, defaulting to `'any'`. */
export function tagMatchOf(value: unknown): TagMatch {
  return isTagMatch(value) ? value : 'any';
}

/**
 * Coerces one raw tag value to its canonical form: only strings are accepted,
 * then trimmed and lower-cased. Anything else (null, numbers, objects, …)
 * yields `''`, and an empty result always means "no value" — never a value
 * that could match. The trim+case fold is what makes `'  Kaji '` and `'kaji`
 * the same tag; `src/lib/validate.ts` uses the same fold for usernames.
 */
export function normaliseTagValue(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

/**
 * Normalises a whole collection of raw tag values (`normaliseTagValue` per
 * item), dropping every empty result. Tolerates `null`, `undefined`, and any
 * non-iterable junk by returning an empty set rather than throwing — tag
 * collections arrive from form bodies and D1 rows, neither of which is typed
 * at the boundary. A lone string is treated as one value, never as its
 * characters: nothing a caller passes in should ever split `'kaji'` into `k`,
 * `a`, `j`, `i`.
 */
export function normaliseTagValues(raw: Iterable<unknown> | null | undefined): Set<string> {
  const values = new Set<string>();
  if (raw == null) return values;

  const source: unknown = raw;
  if (typeof source === 'string') {
    const value = normaliseTagValue(source);
    if (value !== '') values.add(value);
    return values;
  }
  if (typeof source !== 'object' || typeof (source as { [Symbol.iterator]?: unknown })[Symbol.iterator] !== 'function') {
    return values;
  }

  for (const item of source as Iterable<unknown>) {
    const value = normaliseTagValue(item);
    if (value !== '') values.add(value);
  }
  return values;
}

/**
 * True iff the two (already-normalised) tag-value collections intersect.
 * Either set being empty means no sharing: an owner with no tags must not
 * "share" with a viewer who also has none, and a tagless viewer cannot match
 * anyone either — an empty collection is the absence of a claim, not a claim
 * that matches everything.
 */
export function shareTagValue(viewerTagValues: ReadonlySet<string>, ownerTagValues: ReadonlySet<string>): boolean {
  if (viewerTagValues.size === 0 || ownerTagValues.size === 0) return false;
  // Probe the smaller collection against the larger one.
  const [probe, lookup] =
    viewerTagValues.size <= ownerTagValues.size ? [viewerTagValues, ownerTagValues] : [ownerTagValues, viewerTagValues];
  for (const value of probe) {
    if (lookup.has(value)) return true;
  }
  return false;
}

/**
 * The explicit per-user lists for one block, read from
 * `profile_block_viewers` (see `groupViewerLists`).
 */
export interface BlockViewerLists {
  allow: readonly string[];
  deny: readonly string[];
}

/** The "no allow/deny rows" default — reused so callers never allocate a fresh pair. */
export const EMPTY_BLOCK_VIEWER_LISTS: BlockViewerLists = { allow: [], deny: [] };

/**
 * The optional per-block conditions that refine the base `visibility`. Every
 * field is ANDed on top of the audience in `canViewBlock`; empty lists and
 * null scalars mean "no such condition".
 */
export interface BlockConditions {
  /** Follow-relation requirement, or null for none. */
  relation: BlockRelation | null;
  /** Normalised tag values the viewer must carry (matched by `tagMatch`). */
  requiredTags: readonly string[];
  /** `'any'` = at least one required tag, `'all'` = every one of them. */
  tagMatch: TagMatch;
  /** Normalised tag values that exclude the viewer (any single hit denies). */
  excludedTags: readonly string[];
  /** User ids explicitly allowed; empty = no allow-list rule. */
  allowUserIds: readonly string[];
  /** User ids explicitly denied. */
  denyUserIds: readonly string[];
  /** Minimum whole days the viewer has been following, or null for none. */
  minFollowDays: number | null;
  /** Minimum whole days the viewer's account must have existed, or null for none. */
  minAccountAgeDays: number | null;
  /** Epoch ms the block becomes visible, or null for "always has been". */
  visibleFrom: number | null;
  /** Epoch ms the block stops being visible (exclusive), or null for never. */
  visibleUntil: number | null;
}

/** The "no extra condition" set — the common case for a plain block. */
export const NO_CONDITIONS: BlockConditions = {
  relation: null,
  requiredTags: [],
  tagMatch: 'any',
  excludedTags: [],
  allowUserIds: [],
  denyUserIds: [],
  minFollowDays: null,
  minAccountAgeDays: null,
  visibleFrom: null,
  visibleUntil: null,
};

/**
 * True when at least one condition is set (a refinement that can change who
 * sees the block). `tagMatch` alone is not a condition: it is meaningless
 * while `requiredTags` is empty.
 */
export function hasConditions(conditions: BlockConditions): boolean {
  return (
    conditions.relation !== null ||
    conditions.requiredTags.length > 0 ||
    conditions.excludedTags.length > 0 ||
    conditions.allowUserIds.length > 0 ||
    conditions.denyUserIds.length > 0 ||
    conditions.minFollowDays !== null ||
    conditions.minAccountAgeDays !== null ||
    conditions.visibleFrom !== null ||
    conditions.visibleUntil !== null
  );
}

const MS_PER_DAY = 86_400_000;

/** Whole days between two epoch-ms timestamps, clamped at zero (clock skew). */
export function wholeDaysBetween(startedAt: number, now: number): number {
  return Math.max(0, Math.floor((now - startedAt) / MS_PER_DAY));
}

/**
 * Does a follow that started at `followStartedAt` satisfy a `minFollowDays`
 * requirement? Not following (`null`) never satisfies any requirement — even
 * 0 (which means "any follower"), because a non-follower is not a follower.
 */
export function meetsMinFollowDays(
  minFollowDays: number,
  followStartedAt: number | null,
  now: number,
): boolean {
  if (followStartedAt === null) return false;
  return wholeDaysBetween(followStartedAt, now) >= minFollowDays;
}

/**
 * Does an account created at `accountCreatedAt` satisfy a `minAccountAgeDays`
 * requirement? A missing timestamp (anonymous viewer, or a row that somehow
 * lacks one) never satisfies any requirement, mirroring `meetsMinFollowDays`.
 */
export function meetsMinAccountAgeDays(
  minAccountAgeDays: number,
  accountCreatedAt: number | null,
  now: number,
): boolean {
  if (accountCreatedAt === null) return false;
  return wholeDaysBetween(accountCreatedAt, now) >= minAccountAgeDays;
}

/**
 * Does the viewer's tag set satisfy a `requiredTags` requirement? An empty
 * list is trivially satisfied (there is nothing to require); `'all'` demands
 * every value, `'any'` at least one. An empty viewer set satisfies neither a
 * non-empty `'any'` nor a non-empty `'all'` list.
 */
export function satisfiesTagRequirement(
  requiredTags: readonly string[],
  tagMatch: TagMatch,
  viewerTagValues: ReadonlySet<string>,
): boolean {
  if (requiredTags.length === 0) return true;
  if (tagMatch === 'all') return requiredTags.every((tag) => viewerTagValues.has(tag));
  return requiredTags.some((tag) => viewerTagValues.has(tag));
}

/** Everything `canViewBlock` needs to know about one (viewer, owner) pair. */
export interface AudienceContext {
  /** True when the viewer is the profile's owner. An unconditional override. */
  isOwner: boolean;
  /** True when the request carried a valid session. Anonymous = false. */
  viewerIsAuthenticated: boolean;
  /** The viewer's user id, or null when anonymous. Drives allow/deny lists. */
  viewerId: string | null;
  /** The viewer's normalised tag values; empty for an anonymous viewer. */
  viewerTagValues: ReadonlySet<string>;
  /** The owner's normalised tag values (all of them, hidden tags included). */
  ownerTagValues: ReadonlySet<string>;
  /** True when the viewer follows the owner (may be unknown → false). */
  viewerFollowsOwner: boolean;
  /** True when the owner follows the viewer (may be unknown → false). */
  ownerFollowsViewer: boolean;
  /** Epoch ms the viewer started following the owner, or null if not following. */
  followStartedAt: number | null;
  /** Epoch ms the viewer account was created, or null when anonymous. */
  viewerAccountCreatedAt: number | null;
  /** "Now" in epoch ms — injected by the caller so this stays pure/testable. */
  now: number;
}

/**
 * The single decision point: may this viewer see this block?
 *
 * The owner branch is unconditional and comes first. Owners are authenticated
 * in practice, but correctness must not depend on the caller *also* remembering
 * to pass a truthful `viewerIsAuthenticated` alongside `isOwner` — a bogus
 * context should still give the owner their own blocks.
 *
 * Everything else fails closed: an unknown or typo'd visibility reaching this
 * function (a value that slipped past the storage CHECK — a hand-written
 * INSERT, or a stale row left behind if a literal were ever renamed) is *not*
 * viewable by a non-owner. Hiding the block is always the safe failure.
 */
export function canViewBlock(
  visibility: BlockVisibility,
  conditions: BlockConditions,
  ctx: AudienceContext,
): boolean {
  if (ctx.isOwner) return true; // Owners always see their own blocks, conditions included.

  // The base audience must pass first (a `self` block already fails here for
  // non-owners). Every condition is then ANDed on top.
  if (!baseAudienceVisible(visibility, ctx)) return false;

  // Follow-relation requirement.
  if (!relationVisible(conditions.relation, ctx)) return false;

  // Explicit allow/deny lists. An allow list, when non-empty, is a positive
  // requirement — an anonymous viewer has no id and therefore cannot satisfy
  // it. A deny list is a pure exclusion and only ever matches a real id.
  if (conditions.allowUserIds.length > 0) {
    if (!ctx.viewerId || !conditions.allowUserIds.includes(ctx.viewerId)) return false;
  }
  if (ctx.viewerId && conditions.denyUserIds.includes(ctx.viewerId)) return false;

  // Tag conditions. `excludedTags` is a negation: any single hit denies.
  if (!satisfiesTagRequirement(conditions.requiredTags, conditions.tagMatch, ctx.viewerTagValues)) {
    return false;
  }
  for (const tag of conditions.excludedTags) {
    if (ctx.viewerTagValues.has(tag)) return false;
  }

  // Age and time gates.
  if (
    conditions.minFollowDays !== null &&
    !meetsMinFollowDays(conditions.minFollowDays, ctx.followStartedAt, ctx.now)
  ) {
    return false;
  }
  if (
    conditions.minAccountAgeDays !== null &&
    !meetsMinAccountAgeDays(conditions.minAccountAgeDays, ctx.viewerAccountCreatedAt, ctx.now)
  ) {
    return false;
  }
  if (conditions.visibleFrom !== null && ctx.now < conditions.visibleFrom) return false;
  if (conditions.visibleUntil !== null && ctx.now >= conditions.visibleUntil) return false;

  return true;
}

/**
 * The base audience decision (widest→narrowest) before any per-block
 * conditions are applied. Extracted so the conditions read as a clean AND on
 * top of it. Fails closed on an unknown visibility.
 */
function baseAudienceVisible(visibility: BlockVisibility, ctx: AudienceContext): boolean {
  switch (visibility) {
    case 'public':
      return true; // Everyone, anonymous viewers included.
    case 'users':
      return ctx.viewerIsAuthenticated;
    case 'same_tag':
      // Authentication is enforced explicitly rather than inferred from the
      // tag sets: an anonymous viewer has no tags of record, so a populated
      // `viewerTagValues` for one could only be a caller bug — a stale set, or
      // the owner's own tags reused — that would silently widen the audience.
      // The session is the trusted signal; the tag sets are not.
      return ctx.viewerIsAuthenticated && shareTagValue(ctx.viewerTagValues, ctx.ownerTagValues);
    case 'self':
      return false; // Owner only, handled by the override above.
    default:
      return false; // Unknown visibility: fail closed for non-owners.
  }
}

/**
 * The follow-relation condition (`followers` = the viewer follows the owner,
 * `following` = the owner follows the viewer, `mutual` = both). `null` means
 * "no relation rule" and always passes. Authentication is required explicitly
 * for the same reason as `same_tag`: the follow flags are only trustworthy for
 * a real session.
 */
function relationVisible(relation: BlockRelation | null, ctx: AudienceContext): boolean {
  switch (relation) {
    case null:
      return true;
    case 'followers':
      return ctx.viewerIsAuthenticated && ctx.viewerFollowsOwner;
    case 'following':
      return ctx.viewerIsAuthenticated && ctx.ownerFollowsViewer;
    case 'mutual':
      return ctx.viewerIsAuthenticated && ctx.viewerFollowsOwner && ctx.ownerFollowsViewer;
    default:
      return false; // Unknown relation: fail closed for non-owners.
  }
}

/**
 * Defensive JSON-array reader for a stored list column (`required_tags`,
 * `excluded_tags`). Anything that is not a JSON array of strings yields `[]`,
 * so a malformed stored value degrades to "no values" rather than throwing.
 */
export function parseStoredList(value: unknown): string[] {
  if (typeof value !== 'string' || value.trim() === '') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((entry): entry is string => typeof entry === 'string');
}

/** Normalised, de-duplicated tag list read from a stored JSON column. */
function normalisedTagList(value: unknown): string[] {
  const out: string[] = [];
  for (const item of parseStoredList(value)) {
    const normalised = normaliseTagValue(item);
    if (normalised !== '' && !out.includes(normalised)) out.push(normalised);
  }
  return out;
}

function nonNegativeIntOrNull(value: unknown): number | null {
  const n =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/**
 * Reads a block row's rule columns defensively and normalises them, mirroring
 * `isBlockVisibility`'s fail-closed stance: a missing or malformed value
 * degrades to "no condition" (the rule is simply not enforced), never to a
 * value that could widen the audience. The rules live in the `profile_block_rules`
 * satellite (flattened onto the row as `rule_*` by `listProfileBlocks`) and the
 * allow/deny lists in a child table, so the caller passes the lists in.
 */
export function conditionsOfRow(
  row: {
    rule_relation?: unknown;
    rule_required_tags?: unknown;
    rule_tag_match?: unknown;
    rule_excluded_tags?: unknown;
    rule_min_follow_days?: unknown;
    rule_min_account_age_days?: unknown;
    rule_visible_from?: unknown;
    rule_visible_until?: unknown;
  },
  lists: BlockViewerLists = EMPTY_BLOCK_VIEWER_LISTS,
): BlockConditions {
  return {
    relation: relationOf(row.rule_relation),
    requiredTags: normalisedTagList(row.rule_required_tags),
    tagMatch: tagMatchOf(row.rule_tag_match),
    excludedTags: normalisedTagList(row.rule_excluded_tags),
    allowUserIds: lists.allow,
    denyUserIds: lists.deny,
    minFollowDays: nonNegativeIntOrNull(row.rule_min_follow_days),
    minAccountAgeDays: nonNegativeIntOrNull(row.rule_min_account_age_days),
    visibleFrom: nonNegativeIntOrNull(row.rule_visible_from),
    visibleUntil: nonNegativeIntOrNull(row.rule_visible_until),
  };
}

/**
 * Groups `profile_block_viewers` rows into one `BlockViewerLists` per block id.
 * Rows with an unknown `kind` are dropped (fail closed — an unrecognised row
 * must never become an allow entry). A user appearing in both lists stays
 * denied, because a deny is the safe reading of a contradictory pair.
 */
export function groupViewerLists(
  rows: readonly { block_id: string; user_id: string; kind: string }[],
): Map<string, BlockViewerLists> {
  const allow = new Map<string, string[]>();
  const deny = new Map<string, string[]>();
  for (const row of rows) {
    if (typeof row.user_id !== 'string' || row.user_id === '') continue;
    if (row.kind === 'allow') {
      pushUnique(allow, row.block_id, row.user_id);
    } else if (row.kind === 'deny') {
      pushUnique(deny, row.block_id, row.user_id);
    }
  }
  const out = new Map<string, BlockViewerLists>();
  for (const blockId of new Set([...allow.keys(), ...deny.keys()])) {
    const denied = deny.get(blockId) ?? [];
    const allowed = (allow.get(blockId) ?? []).filter((id) => !denied.includes(id));
    out.set(blockId, { allow: allowed, deny: denied });
  }
  return out;
}

function pushUnique(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key);
  if (!list) {
    map.set(key, [value]);
    return;
  }
  if (!list.includes(value)) list.push(value);
}

/**
 * True iff the rendered result is identical for every viewer. This is the
 * profile-cache contract made explicit: the anonymous KV-cached profile HTML
 * (`src/lib/profile-cache.ts`, one copy served to every visitor for 300s) may
 * embed only blocks that pass this test, so a caller cannot accidentally bake
 * a viewer-specific block into the shared copy. Only a `public` block with no
 * conditions qualifies — the wider audiences and every condition (tags, user
 * lists, age gates, and even a time window, which ages out) all vary with the
 * viewer or with time. An unknown visibility is viewer-dependent by the same
 * fail-closed rule: if it cannot be proven shareable with the world, it must
 * not be cached.
 */
export function isViewerIndependent(visibility: BlockVisibility, conditions: BlockConditions): boolean {
  return visibility === 'public' && !hasConditions(conditions);
}
