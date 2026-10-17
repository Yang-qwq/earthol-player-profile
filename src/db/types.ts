/** Row shapes returned by D1, matching `schema.sql` column-for-column. */

/** The kinds of profile block a user can add to their profile. */
export type BlockKind = 'text' | 'gallery';

/**
 * Per-block base audience. Mirrors the `profile_blocks.visibility` CHECK in
 * `schema.sql` — shared with the audience predicate, so the two must always
 * agree on the literal values. Widest→narrowest, as listed in `AUDIENCES`
 * (`src/lib/audience.ts`).
 */
export type BlockVisibility = 'public' | 'users' | 'same_tag' | 'self';

/**
 * A follow-relation refinement, stored in `profile_block_rules.relation` and
 * ANDed on top of `visibility` (see `src/lib/audience.ts`). Kept off the
 * `visibility` CHECK on purpose: widening that CHECK needs a table rebuild,
 * which would make `migrations/0004` non-idempotent.
 */
export type BlockRelation = 'followers' | 'following' | 'mutual';

/** How a block's `required_tags` list is matched: any one value, or all of them. */
export type TagMatch = 'any' | 'all';

export interface UserRow {
  id: string;
  email: string | null;
  username: string | null;
  display_name: string | null;
  headline: string | null;
  bio: string | null;
  avatar_url: string | null;
  location: string | null;
  website: string | null;
  pronouns: string | null;
  theme: string;
  visibility: string;
  is_admin: number;
  created_at: number;
  updated_at: number;
  /** Present only on admin search results: 1 when an active ban exists. */
  is_banned?: number;
}

export interface IdentityRow {
  id: string;
  user_id: string;
  provider: string;
  provider_user_id: string;
  email: string | null;
  created_at: number;
}

export interface FieldRow {
  id: string;
  user_id: string;
  label: string;
  value: string;
  sort_order: number;
  created_at: number;
}

export interface TagCategoryRow {
  id: string;
  name: string;
  color: string;
  sort_order: number;
  created_at: number;
}

export interface UserTagRow {
  id: string;
  user_id: string;
  category_id: string;
  value: string;
  hidden: number;
  sort_order: number;
  created_at: number;
  category_name: string;
  category_color: string;
}

export interface FollowRow {
  follower_id: string;
  following_id: string;
  created_at: number;
}

export interface LoginTokenRow {
  token_hash: string;
  email: string;
  expires_at: number;
  consumed_at: number | null;
  created_at: number;
}

export interface TotpFactorRow {
  user_id: string;
  secret: string;
  confirmed: number;
  last_step: number | null;
  created_at: number;
  updated_at: number;
}

export interface ProfileInput {
  username: string;
  displayName: string | null;
  headline: string | null;
  bio: string | null;
  avatarUrl: string | null;
  location: string | null;
  website: string | null;
  pronouns: string | null;
  theme: string;
  visibility: string;
}

export interface FieldInput {
  label: string;
  value: string;
}

/**
 * The optional refinements for one block, stored in `profile_block_rules`.
 * Every field is optional; an absent field means "no such condition".
 */
export interface BlockRulesInput {
  /** Follow-relation requirement, or null. */
  relation: BlockRelation | null;
  /** Tag values the viewer must carry (matched by `tagMatch`). */
  requiredTags: string[];
  tagMatch: TagMatch;
  /** Tag values the viewer must not carry (any hit excludes them). */
  excludedTags: string[];
  minFollowDays: number | null;
  minAccountAgeDays: number | null;
  /** Epoch ms the block starts/stops being visible; null = unbounded. */
  visibleFrom: number | null;
  visibleUntil: number | null;
}

/**
 * A profile block as a caller supplies it. `user_id`, `id`, and the timestamps
 * are assigned by `replaceProfileBlocks` — never by the caller. A 'text' block
 * must carry a non-null `body`, a 'gallery' block a non-null `items` (a JSON
 * array string), matching the table's CHECK constraints. `rules` and the two
 * user-id lists are the audience refinements (`src/lib/audience.ts`).
 */
export interface BlockInput {
  kind: BlockKind;
  title: string | null;
  body: string | null;
  items: string | null;
  visibility: BlockVisibility;
  rules: BlockRulesInput;
  /** User ids explicitly allowed / denied; resolved by the route from usernames. */
  allowUserIds: string[];
  denyUserIds: string[];
}

/**
 * A `profile_blocks` row LEFT JOINed with its `profile_block_rules` satellite
 * (`*` from the block plus `rule_*` from the rules, null when the block has no
 * rules). D1 rows are untyped at the boundary, so every value is read
 * defensively. `required_tag` / `min_follow_days` are legacy columns kept only
 * so `SELECT b.*` keeps working; nothing reads them.
 */
export interface ProfileBlockRow {
  id: string;
  user_id: string;
  kind: string;
  title: string | null;
  body: string | null;
  items: string | null;
  visibility: string;
  /** @deprecated folded into `rule_required_tags` by `migrations/0004`. */
  required_tag?: string | null;
  /** @deprecated folded into `rule_min_follow_days` by `migrations/0004`. */
  min_follow_days?: number | null;
  sort_order: number;
  created_at: number;
  updated_at: number;
  /** `'followers'` | `'following'` | `'mutual'`, or null. */
  rule_relation: string | null;
  /** JSON array of normalised tag values the viewer must carry, or null. */
  rule_required_tags: string | null;
  /** `'any'` | `'all'` — how `rule_required_tags` is matched. */
  rule_tag_match: string | null;
  /** JSON array of normalised tag values that exclude the viewer, or null. */
  rule_excluded_tags: string | null;
  /** Minimum whole days the viewer must have been following, or null. */
  rule_min_follow_days: number | null;
  /** Minimum whole days the viewer's account must have existed, or null. */
  rule_min_account_age_days: number | null;
  /** Epoch ms the block becomes visible / stops being visible, or null. */
  rule_visible_from: number | null;
  rule_visible_until: number | null;
}

/** A `profile_block_rules` row (1:1 with a block; absent = no rules). */
export interface ProfileBlockRuleRow {
  block_id: string;
  relation: string | null;
  required_tags: string | null;
  tag_match: string;
  excluded_tags: string | null;
  min_follow_days: number | null;
  min_account_age_days: number | null;
  visible_from: number | null;
  visible_until: number | null;
}

/** One explicit allow/deny row in `profile_block_viewers` (with `username` joined for display). */
export interface BlockViewerRow {
  block_id: string;
  user_id: string;
  kind: string;
  username: string | null;
}

/** A `profile_layout` row: where the key/value fields card sits among the blocks. */
export interface ProfileLayoutRow {
  user_id: string;
  fields_position: number;
}

export interface TagInput {
  categoryId: string;
  value: string;
  hidden: boolean;
}

/* ----------------------------- moderation ----------------------------- */

/** Moderation workflow state of a report; mirrors the `reports.status` CHECK. */
export type ReportStatus = 'open' | 'resolved' | 'dismissed';

/**
 * A `reports` row joined with the display fields of its reporter, target, and
 * handling moderator. Reporter/handler names are null once that account has
 * been deleted (the FKs are `ON DELETE SET NULL`).
 */
export interface ReportRow {
  id: string;
  reporter_id: string | null;
  target_user_id: string;
  reason: string;
  details: string | null;
  status: string;
  resolution: string | null;
  handled_by: string | null;
  handled_at: number | null;
  created_at: number;
  updated_at: number;
  reporter_username: string | null;
  reporter_display_name: string | null;
  target_username: string | null;
  target_display_name: string | null;
  handler_username: string | null;
}

/**
 * The raw `user_bans` columns (one row per account, the row is replaced on a
 * re-ban). `expires_at === null` means permanent; `revoked_at !== null` means
 * the ban was lifted.
 */
export interface BanStateRow {
  user_id: string;
  reason: string;
  note: string | null;
  created_by: string | null;
  created_at: number;
  expires_at: number | null;
  revoked_at: number | null;
  revoked_by: string | null;
}

/**
 * A `user_bans` row joined with the banned user's handle and the acting admin's
 * handle, for the admin console.
 */
export interface UserBanRow extends BanStateRow {
  username: string | null;
  display_name: string | null;
  created_by_username: string | null;
  revoked_by_username: string | null;
}

/** One append-only row in `moderation_actions`. */
export interface ModerationActionRow {
  id: string;
  actor_id: string | null;
  action: string;
  target_user_id: string | null;
  report_id: string | null;
  note: string | null;
  created_at: number;
  actor_username: string | null;
  target_username: string | null;
}

/**
 * A moderator's in-app reply to the person who filed a report, joined with the
 * author's display fields. `read_at === null` means the reporter has not opened
 * their inbox since it arrived.
 */
export interface ReportReceiptRow {
  id: string;
  report_id: string;
  admin_id: string | null;
  body: string;
  created_at: number;
  read_at: number | null;
  admin_username: string | null;
  admin_display_name: string | null;
}
