/**
 * Authenticated dashboard: profile sheet, key/value fields, and tags. Fields
 * and tags are replaced wholesale on submit; every write invalidates the
 * profile HTML cache for the affected handle.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppContext } from '../types';
import { Dashboard, TotpCard } from '../views/dashboard';
import type { BlockInput, BlockRelation, FieldInput, TagInput } from '../db/types';
import { DASHBOARD_SECTION_PATH, type DashboardSection } from '../lib/dashboard-nav';
import {
  createLoginToken,
  confirmTotpFactor,
  countUnreadReceipts,
  deleteTotpFactor,
  getTotpFactor,
  getProfileLayout,
  getUserByEmail,
  isUsernameReserved,
  isUsernameTakenByOther,
  listBlockViewers,
  listFields,
  listIdentities,
  listProfileBlocks,
  listTagCategories,
  listUserTags,
  replaceFields,
  replaceProfileBlocks,
  replaceUserTags,
  resolveUsernames,
  setProfileLayout,
  updateProfile,
  upsertPendingTotpFactor,
  BLOCK_LIMITS,
} from '../db/queries';
import { requireAuth } from '../middleware/auth';
import { invalidateProfiles } from '../lib/profile-cache';
import { parseGalleryItems } from '../lib/blocks';
import { isBlockRelation, isBlockVisibility } from '../lib/audience';
import { gravatarAvatarUrl } from '../lib/gravatar';
import { githubConfigured } from '../lib/oauth-github';
import { resolveGithub, resolveGravatarMirror, resolveMailer } from '../lib/config';
import { DEFAULT_CHAT_PROMPT, resolveOpenAI } from '../lib/openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { isTheme, isVisibility } from '../lib/themes';
import {
  deleteStoredImage,
  isStoredPath,
  MAX_AVATAR_BYTES,
  MAX_GALLERY_BYTES,
  STORAGE_PATH_PREFIX,
  STORAGE_PREFIXES,
  storageEnabled,
  storedPathOwner,
  storeGalleryImage,
  storeImage,
} from '../lib/storage';
import {
  isSafeUrl,
  isValidEmail,
  isValidUsername,
  normalizeEmail,
  normalizeUsername,
  text,
} from '../lib/validate';
import { randomToken, sha256Hex } from '../lib/crypto';
import { generateTotpSecret, totpUri, verifyTotp } from '../lib/totp';
import { getMailer, magicLinkEmail } from '../lib/email';
import { clientIp, rateLimit } from '../lib/ratelimit';
import { appUrl } from '../lib/env';
import type { TranslateFn } from '../i18n';

export const dashboardRoutes = new Hono<AppContext>();

const MAX_FIELDS = 20;
const MAX_FIELD_LABEL = 40;
const MAX_FIELD_VALUE = 300;
const MAX_TAGS = 20;
const MAX_TAG_VALUE = 40;
const LINK_TTL_SECONDS = 15 * 60;

dashboardRoutes.use('/dashboard', requireAuth);
dashboardRoutes.use('/dashboard/*', requireAuth);

function errorMessage(code: string | undefined, t: TranslateFn): string | undefined {
  switch (code) {
    case 'invalid_username':
      return t('dash.err.invalidUsername');
    case 'reserved_username':
      return t('dash.err.reserved');
    case 'taken_username':
      return t('dash.err.taken');
    case 'invalid_url':
      return t('dash.err.invalidUrl');
    case 'invalid_field':
      return t('dash.err.invalidField');
    case 'too_many_fields':
      return t('dash.err.tooManyFields', { max: String(MAX_FIELDS) });
    case 'invalid_block':
      return t('dash.err.invalidBlock');
    case 'too_many_blocks':
      return t('dash.err.tooManyBlocks', { max: String(BLOCK_LIMITS.maxBlocks) });
    case 'unknown_block_user':
      return t('dash.err.unknownBlockUser');
    case 'invalid_tag':
      return t('dash.err.invalidTag');
    case 'too_many_tags':
      return t('dash.err.tooManyTags', { max: String(MAX_TAGS) });
    case 'unknown_tag_category':
      return t('dash.err.unknownTagCategory');
    case 'invalid_email':
      return t('auth.err.invalidEmail');
    case 'rate_limited':
      return t('auth.err.rateLimited');
    case 'send_failed':
      return t('auth.err.sendFailed');
    case 'magic_disabled':
      return t('auth.err.magicDisabled');
    case 'totp_disabled':
      return t('auth.err.totpDisabled');
    case 'totp_invalid':
      return t('auth.err.totpInvalid');
    case 'github_unavailable':
      return t('login.githubUnavailable');
    case 'github_taken':
      return t('dash.err.githubTaken');
    case 'email_taken':
      return t('dash.err.emailTaken');
    case 'link_failed':
      return t('dash.err.linkFailed');
    case 'storage_unavailable':
    case 'unavailable':
      return t('dash.err.storageUnavailable');
    case 'invalid_file':
      return t('dash.err.invalidFile');
    case 'file_too_large':
      return t('dash.err.fileTooLarge', {
        max: String(MAX_AVATAR_BYTES / (1024 * 1024)),
      });
    case 'gallery_file_too_large':
      return t('dash.err.galleryFileTooLarge', { max: String(MAX_GALLERY_BYTES / (1024 * 1024)) });
    case 'invalid_file_type':
      return t('dash.err.invalidFileType');
    default:
      return undefined;
  }
}

function str(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return '';
}

function toArray(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  return [];
}

/**
 * Renders one dashboard sub-page. Only the data the section displays is
 * loaded; everything else falls back to empty defaults so the view props stay
 * fixed. `/dashboard` is the `profile` page (sign-in and external links still
 * land there).
 */
async function renderDashboard(c: Context<AppContext>, section: DashboardSection) {
  const user = c.get('user')!;
  if (!user.username) return c.redirect('/onboarding');

  const t = c.get('t');
  const settings = c.get('settings');
  const [fields, tags, tagCategories, identities, totpFactor, blocks, blockViewers, fieldsPosition, receiptUnread] = await Promise.all([
    section === 'fields' ? listFields(c.env.DB, user.id) : Promise.resolve([]),
    section === 'tags' ? listUserTags(c.env.DB, user.id) : Promise.resolve([]),
    section === 'tags' ? listTagCategories(c.env.DB) : Promise.resolve([]),
    section === 'security' ? listIdentities(c.env.DB, user.id) : Promise.resolve([]),
    section === 'security' ? getTotpFactor(c.env.DB, user.id) : Promise.resolve(null),
    section === 'blocks' ? listProfileBlocks(c.env.DB, user.id) : Promise.resolve([]),
    section === 'blocks' ? listBlockViewers(c.env.DB, user.id) : Promise.resolve([]),
    section === 'blocks' ? getProfileLayout(c.env.DB, user.id) : Promise.resolve(0),
    countUnreadReceipts(c.env.DB, user.id),
  ]);
  const saved = c.req.query('saved');
  const message =
    saved === 'profile'
      ? t('dash.savedProfile')
      : saved === 'fields'
        ? t('dash.savedFields')
        : saved === 'blocks'
          ? t('dash.savedBlocks')
          : saved === 'tags'
          ? t('dash.savedTags')
          : saved === 'github_linked'
            ? t('dash.saved.githubLinked')
            : saved === 'email_linked'
              ? t('dash.saved.emailLinked')
              : saved === 'email_sent'
                ? t('dash.saved.emailSent')
                : saved === 'totp_started'
                  ? t('dash.saved.totpStarted')
                  : saved === 'totp_enabled'
                    ? t('dash.saved.totpEnabled')
                    : saved === 'totp_removed'
                      ? t('dash.saved.totpRemoved')
                      : saved === 'avatar'
                        ? t('dash.savedAvatar')
                        : undefined;

  // The provisioning URI (with the raw secret) is only exposed while the
  // factor still awaits confirmation.
  const totpAccount = user.email ?? user.username ?? user.id;
  const totpProvisioningUri =
    totpFactor && !totpFactor.confirmed
      ? totpUri(totpFactor.secret, totpAccount, c.get('appName'))
      : null;

  return c.html(
    <Dashboard
      appName={c.get('appName')}
      faviconUrl={c.get('settings').faviconUrl}
      logoUrl={c.get('settings').logoUrl}
      customCss={c.get('settings').customCss}
      customJs={c.get('settings').customJs}
      customFooter={c.get('settings').customFooter}
      csrfToken={c.get('csrfToken')}
      user={user}
      section={section}
      gravatarUrl={await gravatarAvatarUrl(user.email, resolveGravatarMirror(c.env, settings))}
      uploadEnabled={storageEnabled(c.env)}
      fields={fields}
      tags={tags}
      tagCategories={tagCategories}
      blocks={blocks}
      blockViewers={blockViewers}
      fieldsPosition={fieldsPosition}
      identities={identities}
      githubEnabled={githubConfigured(resolveGithub(c.env, settings)) && settings.githubLoginEnabled}
      magicEnabled={settings.magicLinkEnabled}
      totpEnabled={settings.totpLoginEnabled}
      totpFactor={totpFactor}
      totpUri={totpProvisioningUri}
      aiConfigured={Boolean(resolveOpenAI(c.env, settings))}
      receiptUnread={receiptUnread}
      message={message}
      error={errorMessage(c.req.query('error'), t)}
      nonce={c.get('secureHeadersNonce')}
      t={t}
      locale={c.get('locale')}
      pathname={DASHBOARD_SECTION_PATH[section]}
      isAdmin={c.get('isAdmin')}
    />,
  );
}

// One page per sub-module — these are the sidebar's second-level entries.
dashboardRoutes.get('/dashboard', (c) => renderDashboard(c, 'profile'));
dashboardRoutes.get('/dashboard/fields', (c) => renderDashboard(c, 'fields'));
dashboardRoutes.get('/dashboard/blocks', (c) => renderDashboard(c, 'blocks'));
dashboardRoutes.get('/dashboard/tags', (c) => renderDashboard(c, 'tags'));
dashboardRoutes.get('/dashboard/security', (c) => renderDashboard(c, 'security'));
dashboardRoutes.get('/dashboard/ai', (c) => renderDashboard(c, 'ai'));

dashboardRoutes.post('/dashboard/profile', async (c) => {
  const user = c.get('user')!;
  const body = await c.req.parseBody();

  const username = normalizeUsername(str(body.username));
  if (!isValidUsername(username)) return c.redirect('/dashboard?error=invalid_username');
  if (await isUsernameReserved(c.env.DB, username)) {
    return c.redirect('/dashboard?error=reserved_username');
  }
  if (await isUsernameTakenByOther(c.env.DB, username, user.id)) {
    return c.redirect('/dashboard?error=taken_username');
  }

  const websiteRaw = text(body.website, 300);
  const avatarRaw = text(body.avatar_url, 500);
  // Uploaded avatars are same-origin `/files/...` paths, not http(s) URLs —
  // accepted only when the key belongs to this user (`avatars/<userId>/…`).
  if (
    (websiteRaw && !isSafeUrl(websiteRaw)) ||
    (avatarRaw && !isSafeUrl(avatarRaw) &&
      !(isStoredPath(avatarRaw) && storedPathOwner(avatarRaw) === user.id))
  ) {
    return c.redirect('/dashboard?error=invalid_url');
  }

  const theme = text(body.theme, 30);
  const visibility = text(body.visibility, 30);

  const previousUsername = user.username;
  const newAvatarUrl = avatarRaw || null;

  // Clearing or replacing an uploaded avatar deletes the old stored object.
  if (isStoredPath(user.avatar_url) && user.avatar_url !== newAvatarUrl) {
    await deleteStoredImage(c.env, user.avatar_url, user.id);
  }

  await updateProfile(c.env.DB, user.id, {
    username,
    displayName: text(body.display_name, 80) || null,
    headline: text(body.headline, 120) || null,
    bio: text(body.bio, 1000) || null,
    avatarUrl: newAvatarUrl,
    location: text(body.location, 120) || null,
    website: websiteRaw || null,
    pronouns: text(body.pronouns, 40) || null,
    theme: isTheme(theme) ? theme : 'default',
    visibility: isVisibility(visibility) ? visibility : 'public',
  });

  await invalidateProfiles(c.env.KV, [previousUsername, username]);

  return c.redirect('/dashboard?saved=profile');
});

/**
 * Uploads an avatar into the optional R2 binding and points the profile at
 * it. Only rendered when the binding exists (`storageEnabled`); stored under
 * `avatars/<userId>/<random>.<ext>` and served back via `/files/*`.
 */
dashboardRoutes.post('/dashboard/avatar/upload', async (c) => {
  const user = c.get('user')!;
  if (!storageEnabled(c.env)) return c.redirect('/dashboard?error=storage_unavailable');
  if (!user.username) return c.redirect('/onboarding');

  const ip = clientIp(c.req.raw.headers);
  const [ipLimit, userLimit] = await Promise.all([
    rateLimit(c.env.KV, `upload:ip:${ip}`, 20, 3600),
    rateLimit(c.env.KV, `upload:user:${user.id}`, 20, 3600),
  ]);
  if (!ipLimit.allowed || !userLimit.allowed) {
    return c.redirect('/dashboard?error=rate_limited');
  }

  const body = await c.req.parseBody();
  const result = await storeImage(c.env, {
    ownerId: user.id,
    file: body.file,
    maxBytes: MAX_AVATAR_BYTES,
    prefix: STORAGE_PREFIXES.avatars,
  });
  if ('error' in result) return c.redirect(`/dashboard?error=${result.error}`);

  // Best-effort cleanup of the upload this one replaces.
  if (isStoredPath(user.avatar_url) && user.avatar_url !== result.path) {
    await deleteStoredImage(c.env, user.avatar_url, user.id);
  }

  // Re-save the stored profile with only the avatar changed.
  await updateProfile(c.env.DB, user.id, {
    username: user.username,
    displayName: user.display_name,
    headline: user.headline,
    bio: user.bio,
    avatarUrl: result.path,
    location: user.location,
    website: user.website,
    pronouns: user.pronouns,
    theme: user.theme,
    visibility: user.visibility,
  });
  await invalidateProfiles(c.env.KV, [user.username]);

  return c.redirect('/dashboard?saved=avatar');
});

/**
 * Uploads one image into the optional R2 binding for a gallery block.
 * Returns JSON `{ url }` (same-origin `/files/...`) so the Blocks editor's
 * client script can append the URL to the row's items textarea — unlike the
 * avatar upload this endpoint does not touch any profile state. The input is
 * re-encoded to WebP server-side when possible (src/lib/image.ts); undecodable
 * files are stored verbatim. Served back via `/files/*` and deduplicated
 * against existing items by the editor, not here.
 */
dashboardRoutes.post('/dashboard/gallery-image/upload', async (c) => {
  const user = c.get('user')!;
  if (!storageEnabled(c.env)) return c.json({ error: 'unavailable' }, 503);
  if (!user.username) return c.json({ error: 'unavailable' }, 503);

  const ip = clientIp(c.req.raw.headers);
  const [ipLimit, userLimit] = await Promise.all([
    rateLimit(c.env.KV, `upload:ip:${ip}`, 20, 3600),
    rateLimit(c.env.KV, `upload:user:${user.id}`, 20, 3600),
  ]);
  if (!ipLimit.allowed || !userLimit.allowed) {
    return c.json({ error: 'rate_limited' }, 429);
  }

  const body = await c.req.parseBody();
  const result = await storeGalleryImage(c.env, { ownerId: user.id, file: body.file });
  if ('error' in result) {
    // Mirror the avatar endpoint's error→status mapping so the editor can
    // surface a specific message.
    const status = result.error === 'unavailable' ? 503 : 400;
    return c.json({ error: result.error }, status);
  }

  return c.json({ url: result.path }, 200, { 'Cache-Control': 'no-store' });
});

dashboardRoutes.post('/dashboard/fields', async (c) => {
  const user = c.get('user')!;
  const body = await c.req.parseBody({ all: true });

  const labels = toArray(body.label);
  const values = toArray(body.value);

  const fields: FieldInput[] = [];
  for (let i = 0; i < Math.max(labels.length, values.length); i += 1) {
    const label = (labels[i] ?? '').trim();
    const value = (values[i] ?? '').trim();
    if (!label && !value) continue;
    if (!label || !value) return c.redirect('/dashboard/fields?error=invalid_field');

    fields.push({ label: label.slice(0, MAX_FIELD_LABEL), value: value.slice(0, MAX_FIELD_VALUE) });
  }

  if (fields.length > MAX_FIELDS) return c.redirect('/dashboard/fields?error=too_many_fields');

  await replaceFields(c.env.DB, user.id, fields);
  await invalidateProfiles(c.env.KV, [user.username]);
  return c.redirect('/dashboard/fields?saved=fields');
});

dashboardRoutes.post('/dashboard/blocks', async (c) => {
  const user = c.get('user')!;
  const body = await c.req.parseBody({ all: true });

  const kinds = toArray(body.kind);
  const titles = toArray(body.title);
  const bodies = toArray(body.body);
  const items = toArray(body.items);
  const visibilities = toArray(body.visibility);
  // Audience refinements. Every list/field is optional: an empty value means
  // "no such condition" for that block.
  const relations = toArray(body.relation);
  const requiredTagsRaw = toArray(body.required_tags);
  const tagMatches = toArray(body.tag_match);
  const excludedTagsRaw = toArray(body.excluded_tags);
  const minFollowDays = toArray(body.min_follow_days);
  const minAccountAgeDays = toArray(body.min_account_age_days);
  const visibleFromRaw = toArray(body.visible_from);
  const visibleUntilRaw = toArray(body.visible_until);
  const allowUsersRaw = toArray(body.allow_users);
  const denyUsersRaw = toArray(body.deny_users);
  // Read the previous list up front so the block replace below can delete the
  // R2 uploads it orphans (replace-on-submit, same pattern as the avatar
  // upload's cleanup). Only gallery items matter: external URLs own their
  // storage, and non-gallery blocks carry no uploads.
  const previousBlocks = await listProfileBlocks(c.env.DB, user.id);

  const splitLines = (value: string): string[] =>
    value
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

  /** Parses a `datetime-local` value to epoch ms (UTC). null = empty, undefined = invalid. */
  function parseDateTime(value: string): number | null | undefined {
    if (value === '') return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
    if (!match) return undefined;
    const ms = Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6] ?? '0'),
    );
    return Number.isFinite(ms) ? ms : undefined;
  }

  /** One submitted row, or null when fully empty (dropped, as with fields). */
  function rowAt(index: number) {
    const kind = (kinds[index] ?? '').trim();
    const visibility = (visibilities[index] ?? '').trim();
    const title = (titles[index] ?? '').trim();
    const bodyText = (bodies[index] ?? '').trim();
    // Gallery items are one URL per line; blanks collapse to nothing.
    const images = splitLines(items[index] ?? '');
    const relation = (relations[index] ?? '').trim();
    const requiredTags = splitLines(requiredTagsRaw[index] ?? '');
    const tagMatch = (tagMatches[index] ?? '').trim();
    const excludedTags = splitLines(excludedTagsRaw[index] ?? '');
    const allowUsers = splitLines(allowUsersRaw[index] ?? '');
    const denyUsers = splitLines(denyUsersRaw[index] ?? '');
    const minFollowDaysRaw = (minFollowDays[index] ?? '').trim();
    const minAccountAgeDaysRaw = (minAccountAgeDays[index] ?? '').trim();
    return {
      kind, visibility, title, bodyText, images, relation, requiredTags, tagMatch, excludedTags,
      allowUsers, denyUsers, minFollowDaysRaw, minAccountAgeDaysRaw,
      visibleFromRaw: (visibleFromRaw[index] ?? '').trim(),
      visibleUntilRaw: (visibleUntilRaw[index] ?? '').trim(),
    };
  }

  const seen: BlockInput[] = [];
  const pending: { block: BlockInput; allowUsers: string[]; denyUsers: string[] }[] = [];
  const allUsernames: string[] = [];
  // The form interleaves block rows with exactly one non-removable `slot=fields`
  // row (the key/value card). Row order is the profile order, and only block
  // rows consume the index-aligned block arrays — so walk the submitted `slot`
  // list and keep a separate block cursor, recording how many blocks survive
  // before the fields row to get the card's position.
  const slots = toArray(body.slot);
  const rowCount =
    slots.length > 0
      ? slots.length
      : Math.max(
          kinds.length, visibilities.length, titles.length, bodies.length, items.length,
          relations.length, requiredTagsRaw.length, tagMatches.length, excludedTagsRaw.length,
          minFollowDays.length, minAccountAgeDays.length, visibleFromRaw.length,
          visibleUntilRaw.length, allowUsersRaw.length, denyUsersRaw.length,
        );
  let fieldsPosition: number | null = null;
  let blockIndex = 0;

  for (let i = 0; i < rowCount; i += 1) {
    if (slots[i] === 'fields') {
      // Only the first marker counts; a duplicated one is ignored.
      if (fieldsPosition === null) fieldsPosition = seen.length;
      continue;
    }
    const row = rowAt(blockIndex);
    blockIndex += 1;
    // A fully-defaulted row with no content and no condition is dropped, as with
    // fields. A condition alone is not a visible block, so it is still "empty".
    const empty =
      (!row.kind || row.kind === 'text') &&
      (!row.visibility || row.visibility === 'public') &&
      !row.title &&
      !row.bodyText &&
      row.images.length === 0 &&
      !row.relation &&
      (!row.tagMatch || row.tagMatch === 'any') &&
      row.requiredTags.length === 0 &&
      row.excludedTags.length === 0 &&
      row.allowUsers.length === 0 &&
      row.denyUsers.length === 0 &&
      !row.minFollowDaysRaw &&
      !row.minAccountAgeDaysRaw &&
      !row.visibleFromRaw &&
      !row.visibleUntilRaw;
    if (empty) continue;

    // Content is judged against the kind the row claims, because that is what
    // will be stored: a text block needs a body, a gallery needs at least one
    // item. A row that names a kind or audience but carries no matching
    // content (or vice versa) is half-empty — reject rather than silently
    // drop, mirroring the fields rule. Unknown kinds/audiences land here too.
    const hasContent = row.kind === 'gallery' ? row.images.length > 0 : row.bodyText.length > 0;
    if (!row.kind || !row.visibility || !hasContent) {
      return c.redirect('/dashboard/blocks?error=invalid_block');
    }

    // Values outside the known enums are REJECTED, never coerced. Coercing an
    // audience silently *widens* it — `'public'` is the only fallback the DB
    // would accept and it is the widest audience there is, so a typo or a
    // crafted post would publish a block the user meant to restrict, and it
    // would contradict `audience.ts`, which fails closed on unknown values.
    // Coercing a kind or the tag-match mode would likewise change the rule.
    if (
      !isBlockVisibility(row.visibility) ||
      (row.kind !== 'text' && row.kind !== 'gallery') ||
      (row.relation !== '' && !isBlockRelation(row.relation)) ||
      (row.tagMatch !== '' && row.tagMatch !== 'any' && row.tagMatch !== 'all')
    ) {
      return c.redirect('/dashboard/blocks?error=invalid_block');
    }

    // Conditions are validated here rather than coerced downstream: an
    // over-long tag value, an over-count list, a bad day count, a malformed
    // datetime, or an inverted window are all rejected (mirroring the
    // kind/visibility rule). An empty value is simply "no condition".
    const minOk =
      row.minFollowDaysRaw === '' ||
      (/^\d+$/.test(row.minFollowDaysRaw) &&
        Number(row.minFollowDaysRaw) <= BLOCK_LIMITS.maxMinDays);
    const ageOk =
      row.minAccountAgeDaysRaw === '' ||
      (/^\d+$/.test(row.minAccountAgeDaysRaw) &&
        Number(row.minAccountAgeDaysRaw) <= BLOCK_LIMITS.maxMinDays);
    const tagsOk =
      row.requiredTags.length <= BLOCK_LIMITS.maxRequiredTags &&
      row.excludedTags.length <= BLOCK_LIMITS.maxExcludedTags &&
      [...row.requiredTags, ...row.excludedTags].every(
        (tag) => tag.length <= BLOCK_LIMITS.maxTagValueLength,
      );
    const usersOk =
      row.allowUsers.length + row.denyUsers.length <= BLOCK_LIMITS.maxListedUsers;
    const visibleFrom = parseDateTime(row.visibleFromRaw);
    const visibleUntil = parseDateTime(row.visibleUntilRaw);
    const windowOk =
      visibleFrom !== undefined &&
      visibleUntil !== undefined &&
      !(visibleFrom !== null && visibleUntil !== null && visibleFrom >= visibleUntil);
    if (!minOk || !ageOk || !tagsOk || !usersOk || !windowOk) {
      return c.redirect('/dashboard/blocks?error=invalid_block');
    }

    const allowUsers = row.allowUsers.map(normalizeUsername).filter(Boolean);
    const denyUsers = row.denyUsers.map(normalizeUsername).filter(Boolean);
    allUsernames.push(...allowUsers, ...denyUsers);

    const block: BlockInput = {
      kind: row.kind,
      title: row.title || null,
      body: row.kind === 'gallery' ? null : row.bodyText,
      items: row.kind === 'gallery' ? JSON.stringify(row.images) : null,
      visibility: row.visibility,
      rules: {
        relation: row.relation === '' ? null : (row.relation as BlockRelation),
        requiredTags: row.requiredTags,
        tagMatch: row.tagMatch === 'all' ? 'all' : 'any',
        excludedTags: row.excludedTags,
        minFollowDays: row.minFollowDaysRaw === '' ? null : Number(row.minFollowDaysRaw),
        minAccountAgeDays:
          row.minAccountAgeDaysRaw === '' ? null : Number(row.minAccountAgeDaysRaw),
        visibleFrom: visibleFrom ?? null,
        visibleUntil: visibleUntil ?? null,
      },
      // User ids are resolved from usernames below, once for the whole submit.
      allowUserIds: [],
      denyUserIds: [],
    };
    pending.push({ block, allowUsers, denyUsers });
    seen.push(block);
  }

  if (seen.length > BLOCK_LIMITS.maxBlocks) {
    return c.redirect(`/dashboard/blocks?error=too_many_blocks`);
  }

  // Resolve every listed handle to a user id in one query. An unknown handle is
  // rejected rather than silently dropped, so a typo is surfaced instead of
  // quietly narrowing the audience. The owner is never listed against itself.
  const uniqueNames = [...new Set(allUsernames)];
  const resolved = uniqueNames.length > 0 ? await resolveUsernames(c.env.DB, uniqueNames) : new Map();
  if (uniqueNames.some((name) => !resolved.has(name))) {
    return c.redirect('/dashboard/blocks?error=unknown_block_user');
  }
  for (const entry of pending) {
    entry.block.allowUserIds = entry.allowUsers
      .map((name) => resolved.get(name))
      .filter((id): id is string => Boolean(id) && id !== user.id);
    entry.block.denyUserIds = entry.denyUsers
      .map((name) => resolved.get(name))
      .filter((id): id is string => Boolean(id) && id !== user.id);
  }

  // Replace-on-submit: every save rewrites the whole list. `replaceProfileBlocks`
  // clamps lengths and drops anything that still fails the CHECK constraints, so
  // a hostile post can only ever produce at most `maxBlocks` in-range rows.
  await replaceProfileBlocks(c.env.DB, user.id, seen);

  // Best-effort cleanup of the uploads this replace orphans: every stored
  // gallery image (`/files/gallery/<userId>/…`) that was referenced by a
  // previous gallery block but is not referenced by any submitted one. Runs
  // as `waitUntil` like the profile-cache invalidation — a failed delete
  // must never turn a successful save into an error (an orphan is a cost
  // issue, not a correctness one).
  const submittedUrls = new Set<string>();
  for (const block of seen) {
    if (block.kind !== 'gallery' || !block.items) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(block.items);
    } catch {
      continue;
    }
    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        if (typeof entry === 'string') submittedUrls.add(entry.trim());
      }
    }
  }
  const orphaned = new Set<string>();
  for (const block of previousBlocks) {
    if (block.kind !== 'gallery') continue;
    for (const item of parseGalleryItems(block.items)) {
      const url = item.trim();
      if (url.startsWith(STORAGE_PATH_PREFIX) && !submittedUrls.has(url)) orphaned.add(url);
    }
  }
  if (orphaned.size > 0) {
    c.executionCtx.waitUntil(
      Promise.all([...orphaned].map((path) => deleteStoredImage(c.env, path, user.id))),
    );
  }

  // The key/value card's position, clamped to the blocks that were stored.
  await setProfileLayout(c.env.DB, user.id, Math.min(fieldsPosition ?? 0, seen.length));
  // Profile mutation: the cached anonymous profile HTML embeds blocks, so it
  // must not survive the change (a later anonymous fetch would serve it stale).
  await invalidateProfiles(c.env.KV, [user.username]);
  return c.redirect('/dashboard/blocks?saved=blocks');
});

dashboardRoutes.post('/dashboard/tags', async (c) => {
  const user = c.get('user')!;
  const body = await c.req.parseBody({ all: true });

  const values = toArray(body.tag);
  const categoryIds = toArray(body.category_id);
  const hiddenFlags = toArray(body.hidden);

  const categories = await listTagCategories(c.env.DB);
  const knownIds = new Set(categories.map((category) => category.id));

  const tags: TagInput[] = [];
  for (let i = 0; i < Math.max(values.length, categoryIds.length); i += 1) {
    const value = (values[i] ?? '').trim();
    const categoryId = (categoryIds[i] ?? '').trim();
    if (!value && !categoryId) continue;
    if (!value || !categoryId) return c.redirect('/dashboard/tags?error=invalid_tag');
    if (!knownIds.has(categoryId)) {
      return c.redirect('/dashboard/tags?error=unknown_tag_category');
    }

    tags.push({
      value: value.slice(0, MAX_TAG_VALUE),
      categoryId,
      hidden: (hiddenFlags[i] ?? '0') === '1',
    });
  }

  if (tags.length > MAX_TAGS) return c.redirect('/dashboard/tags?error=too_many_tags');

  await replaceUserTags(c.env.DB, user.id, tags);
  await invalidateProfiles(c.env.KV, [user.username]);
  return c.redirect('/dashboard/tags?saved=tags');
});

/** Emails a magic link that binds the address to the signed-in account. */
dashboardRoutes.post('/dashboard/identities/email', async (c) => {
  const user = c.get('user')!;
  const settings = c.get('settings');
  if (!settings.magicLinkEnabled) return c.redirect('/dashboard/security?error=magic_disabled');

  const body = await c.req.parseBody();
  const rawEmail = typeof body.email === 'string' ? body.email : '';
  if (!isValidEmail(rawEmail)) return c.redirect('/dashboard/security?error=invalid_email');
  const email = normalizeEmail(rawEmail);

  const owner = await getUserByEmail(c.env.DB, email);
  if (owner && owner.id !== user.id) return c.redirect('/dashboard/security?error=email_taken');

  const ip = clientIp(c.req.raw.headers);
  const [ipLimit, emailLimit] = await Promise.all([
    rateLimit(c.env.KV, `email:ip:${ip}`, 10, 3600),
    rateLimit(c.env.KV, `email:addr:${email}`, 5, 3600),
  ]);
  if (!ipLimit.allowed || !emailLimit.allowed) {
    return c.redirect('/dashboard/security?error=rate_limited');
  }

  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);
  await createLoginToken(c.env.DB, {
    tokenHash,
    email,
    expiresAt: Date.now() + LINK_TTL_SECONDS * 1000,
  });
  await c.env.KV.put(`link:email:${tokenHash}`, user.id, { expirationTtl: LINK_TTL_SECONDS });

  const link = `${appUrl(c.env)}/auth/email/verify?token=${encodeURIComponent(token)}`;
  // Fire-and-forget after the redirect (see the magic-link handler in
  // src/routes/auth.tsx): the SMTP session must not delay the response.
  c.executionCtx.waitUntil(
    getMailer(resolveMailer(c.env, c.get('settings')))
      .send({
        to: email,
        ...magicLinkEmail(c.get('t'), link, c.get('appName')),
      })
      .catch((error) => {
        console.error('Account link email failed', error);
      }),
  );

  return c.redirect('/dashboard/security?saved=email_sent');
});

/** True when the request was made by htmx, so TOTP actions can swap the card
    in place instead of redirecting (a full reload would scroll to the top). */
function isHtmx(c: Context<AppContext>): boolean {
  return Boolean(c.req.header('HX-Request'));
}

/** Renders just the `#totp-card` fragment for an htmx in-place swap. */
async function renderTotpCard(c: Context<AppContext>, saved?: string, errorCode?: string) {
  const user = c.get('user')!;
  const settings = c.get('settings');
  const t = c.get('t');
  const factor = await getTotpFactor(c.env.DB, user.id);
  const totpAccount = user.email ?? user.username ?? user.id;
  const totpProvisioningUri =
    factor && !factor.confirmed ? totpUri(factor.secret, totpAccount, c.get('appName')) : null;
  const message =
    saved === 'totp_started'
      ? t('dash.saved.totpStarted')
      : saved === 'totp_enabled'
        ? t('dash.saved.totpEnabled')
        : saved === 'totp_removed'
          ? t('dash.saved.totpRemoved')
          : undefined;
  return c.html(
    <TotpCard
      csrfToken={c.get('csrfToken')}
      totpFactor={factor}
      totpUri={totpProvisioningUri}
      totpEnabled={settings.totpLoginEnabled}
      message={message}
      error={errorCode ? errorMessage(errorCode, t) : undefined}
      t={t}
    />,
  );
}

/** Sends a TOTP result back to the Security section: an htmx fragment swap
    when the request came from htmx, otherwise a redirect (the fallback path
    for when htmx is unavailable). */
function totpGoto(c: Context<AppContext>, opts: { saved?: string; error?: string }) {
  const query = opts.saved ? `saved=${opts.saved}` : `error=${opts.error ?? 'totp_invalid'}`;
  if (!isHtmx(c)) return c.redirect(`/dashboard/security?${query}`);
  return renderTotpCard(c, opts.saved, opts.error);
}

/**
 * Generates (or regenerates) the pending TOTP secret. The factor stays
 * unconfirmed — and unusable for sign-in — until a valid code confirms it.
 */
dashboardRoutes.post('/dashboard/totp/setup', async (c) => {
  const user = c.get('user')!;
  const settings = c.get('settings');
  if (!settings.totpLoginEnabled) return totpGoto(c, { error: 'totp_disabled' });

  const limit = await rateLimit(c.env.KV, `totp:setup:${user.id}`, 10, 3600);
  if (!limit.allowed) return totpGoto(c, { error: 'rate_limited' });

  await upsertPendingTotpFactor(c.env.DB, user.id, generateTotpSecret());
  return totpGoto(c, { saved: 'totp_started' });
});

/** Confirms the pending factor with a 6-digit code, enabling TOTP sign-in. */
dashboardRoutes.post('/dashboard/totp/confirm', async (c) => {
  const user = c.get('user')!;
  const settings = c.get('settings');
  if (!settings.totpLoginEnabled) return totpGoto(c, { error: 'totp_disabled' });

  const body = await c.req.parseBody();
  const code = typeof body.code === 'string' ? body.code : '';

  const limit = await rateLimit(c.env.KV, `totp:confirm:${user.id}`, 10, 900);
  if (!limit.allowed) return totpGoto(c, { error: 'rate_limited' });

  const factor = await getTotpFactor(c.env.DB, user.id);
  if (!factor || factor.confirmed) return totpGoto(c, { error: 'totp_invalid' });

  const result = await verifyTotp(factor.secret, code, { window: 1, lastStep: factor.last_step });
  if (!result.valid) return totpGoto(c, { error: 'totp_invalid' });

  await confirmTotpFactor(c.env.DB, user.id, result.step);
  return totpGoto(c, { saved: 'totp_enabled' });
});

/**
 * Removes the TOTP factor. Allowed even when TOTP sign-in is disabled
 * site-wide, so no user can get locked out of managing their own factor.
 * Requires a current valid code.
 */
dashboardRoutes.post('/dashboard/totp/disable', async (c) => {
  const user = c.get('user')!;
  const body = await c.req.parseBody();
  const code = typeof body.code === 'string' ? body.code : '';

  const factor = await getTotpFactor(c.env.DB, user.id);
  if (!factor) return totpGoto(c, { saved: 'totp_removed' });

  const limit = await rateLimit(c.env.KV, `totp:disable:${user.id}`, 10, 900);
  if (!limit.allowed) return totpGoto(c, { error: 'rate_limited' });

  const result = await verifyTotp(factor.secret, code, { window: 1, lastStep: factor.last_step });
  if (!result.valid) return totpGoto(c, { error: 'totp_invalid' });

  await deleteTotpFactor(c.env.DB, user.id);
  return totpGoto(c, { saved: 'totp_removed' });
});

/** AI assistant: streams a chat completion back to the dashboard over SSE. */
let aiChatInFlight = 0;
const AI_CHAT_MAX_CONCURRENCY = 3;

dashboardRoutes.post('/dashboard/ai/chat', async (c) => {
  const user = c.get('user')!;
  const settings = c.get('settings');
  const t = c.get('t');

  const resolved = resolveOpenAI(c.env, settings);
  if (!resolved) {
    return c.json({ error: t('dash.ai.notConfigured') }, 503);
  }

  // Cost abuse guard: this endpoint burns the operator's AI key, so it needs
  // per-user + per-IP rate limits like upload/email/TOTP do.
  const ip = clientIp(c.req.raw.headers);
  const [ipLimit, userLimit] = await Promise.all([
    rateLimit(c.env.KV, `ai:ip:${ip}`, 60, 3600),
    rateLimit(c.env.KV, `ai:user:${user.id}`, 30, 3600),
  ]);
  if (!ipLimit.allowed || !userLimit.allowed) {
    return c.json({ error: t('auth.err.rateLimited') }, 429);
  }

  // Soft cap on simultaneous completions per isolate — quotas alone do not
  // stop one account from fanning out parallel streams.
  if (aiChatInFlight >= AI_CHAT_MAX_CONCURRENCY) {
    return c.json({ error: t('auth.err.rateLimited') }, 429);
  }
  aiChatInFlight += 1;

  const body = await c.req.parseBody();
  let parsed: unknown = [];
  try {
    parsed = JSON.parse(typeof body.messages === 'string' ? body.messages : '[]');
  } catch {
    parsed = [];
  }

  const history: ChatCompletionMessageParam[] = [];
  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') continue;
      const role = (entry as { role?: unknown }).role;
      const content = (entry as { content?: unknown }).content;
      if (typeof content !== 'string') continue;
      const trimmed = content.trim().slice(0, 4000);
      if (!trimmed) continue;
      if (role === 'user') history.push({ role: 'user', content: trimmed });
      else if (role === 'assistant') history.push({ role: 'assistant', content: trimmed });
    }
  }

  if (history.length === 0) {
    return c.json({ error: t('dash.ai.error') }, 400);
  }

  // Prefer the caller's current (possibly unsaved) form content, which the
  // dashboard sends as `profile`; fall back to the stored profile when absent.
  let clientProfile: Record<string, unknown> = {};
  try {
    const raw = typeof body.profile === 'string' ? JSON.parse(body.profile) : null;
    if (raw && typeof raw === 'object') clientProfile = raw as Record<string, unknown>;
  } catch {
    clientProfile = {};
  }

  const value = (key: string, fallback: string): string => {
    const raw = clientProfile[key];
    const text = typeof raw === 'string' ? raw.trim().slice(0, 1000) : '';
    return text || fallback || '(empty)';
  };

  const lines = [
    `display name: ${value('display_name', user.display_name ?? '')}`,
    `headline: ${value('headline', user.headline ?? '')}`,
    `bio: ${value('bio', user.bio ?? '')}`,
    `location: ${value('location', user.location ?? '')}`,
    `website: ${value('website', user.website ?? '')}`,
    `pronouns: ${value('pronouns', user.pronouns ?? '')}`,
  ];

  const clientFields = Array.isArray(clientProfile.fields) ? clientProfile.fields : [];
  const fieldLines = clientFields
    .filter((field): field is Record<string, unknown> => Boolean(field) && typeof field === 'object')
    .map((field) =>
      `${String(field.label ?? '').slice(0, 40)}: ${String(field.value ?? '').slice(0, 300)}`.trim(),
    )
    .filter((line) => line.length > 1)
    .slice(0, 20);
  if (fieldLines.length) lines.push('fields:', ...fieldLines.map((line) => `- ${line}`));

  const clientTags = Array.isArray(clientProfile.tags) ? clientProfile.tags : [];
  const tagValues = clientTags
    .filter((tag): tag is Record<string, unknown> => Boolean(tag) && typeof tag === 'object')
    .map((tag) => {
      const label = String(tag.value ?? '').slice(0, 40).trim();
      const category = String(tag.category ?? '').slice(0, 40).trim();
      if (!label) return '';
      return category ? `${category}: ${label}` : label;
    })
    .filter(Boolean)
    .slice(0, 20);
  if (tagValues.length) lines.push(`tags: ${tagValues.join(', ')}`);

  const profile = lines.join('\n');
  const system = `${settings.openaiPromptChat || DEFAULT_CHAT_PROMPT}\n\nThe user's current profile:\n${profile}`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      try {
        const completion = await resolved.client.chat.completions.create(
          {
            model: resolved.model,
            messages: [{ role: 'system', content: system }, ...history.slice(-20)],
            stream: true,
            temperature: 0.7,
          },
          { timeout: 60_000, maxRetries: 0 },
        );
        for await (const chunk of completion) {
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) send({ delta });
        }
        send({ done: true });
      } catch (error) {
        console.error('AI chat stream error:', error);
        send({ error: t('dash.ai.error') });
      } finally {
        aiChatInFlight -= 1;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
    },
  });
});
