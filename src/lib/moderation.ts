/**
 * Moderation vocabulary and pure helpers shared by the report form, the admin
 * console, and the ban gate. The allowed `reason` values live here (not in a
 * SQL CHECK) so adding one stays an app-only change; `migrations/0006` explains
 * why a CHECK would have to be widened with a table rebuild.
 */
import type { MessageKey } from '../i18n';
import type { BanStateRow } from '../db/types';

export const REPORT_REASONS = [
  'spam',
  'harassment',
  'impersonation',
  'inappropriate',
  'other',
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];

/** i18n keys for the reason labels (kept in lockstep with `REPORT_REASONS`). */
export const REPORT_REASON_KEYS: Record<ReportReason, MessageKey> = {
  spam: 'report.reason.spam',
  harassment: 'report.reason.harassment',
  impersonation: 'report.reason.impersonation',
  inappropriate: 'report.reason.inappropriate',
  other: 'report.reason.other',
};

export function isReportReason(value: unknown): value is ReportReason {
  return typeof value === 'string' && (REPORT_REASONS as readonly string[]).includes(value);
}

export const REPORT_STATUSES = ['open', 'resolved', 'dismissed'] as const;

/** i18n keys for the report states. */
export const REPORT_STATUS_KEYS: Record<(typeof REPORT_STATUSES)[number], MessageKey> = {
  open: 'admin.moderation.status.open',
  resolved: 'admin.moderation.status.resolved',
  dismissed: 'admin.moderation.status.dismissed',
};

export function isReportStatus(value: unknown): value is (typeof REPORT_STATUSES)[number] {
  return typeof value === 'string' && (REPORT_STATUSES as readonly string[]).includes(value);
}

export const MAX_REPORT_DETAILS = 2000;
export const MAX_BAN_NOTE = 500;
export const MAX_MODERATION_NOTE = 500;
export const MAX_RECEIPT_BODY = 1000;

/** Ban lengths offered by the admin console. `days: null` = permanent. */
export const BAN_DURATIONS = [
  { id: '1d', days: 1 },
  { id: '7d', days: 7 },
  { id: '30d', days: 30 },
  { id: '90d', days: 90 },
  { id: 'permanent', days: null },
] as const;

export type BanDuration = (typeof BAN_DURATIONS)[number]['id'];

export function isBanDuration(value: unknown): value is BanDuration {
  return typeof value === 'string' && BAN_DURATIONS.some((entry) => entry.id === value);
}

export function banDurationKey(id: BanDuration): MessageKey {
  switch (id) {
    case '1d':
      return 'admin.moderation.duration.1d';
    case '7d':
      return 'admin.moderation.duration.7d';
    case '30d':
      return 'admin.moderation.duration.30d';
    case '90d':
      return 'admin.moderation.duration.90d';
    default:
      return 'admin.moderation.duration.permanent';
  }
}

/**
 * Epoch ms a ban of `duration` ends, or null for a permanent ban. Returns null
 * for an unknown duration too; callers validate with `isBanDuration` first.
 */
export function banExpiry(duration: BanDuration, from = Date.now()): number | null {
  const entry = BAN_DURATIONS.find((candidate) => candidate.id === duration);
  if (!entry) return null;
  return entry.days === null ? null : from + entry.days * 24 * 60 * 60 * 1000;
}

/** Whether a ban currently applies (not lifted and not expired). */
export function isBanActive(
  ban: Pick<BanStateRow, 'revoked_at' | 'expires_at'> | null | undefined,
  at = Date.now(),
): boolean {
  if (!ban || ban.revoked_at !== null) return false;
  return ban.expires_at === null || ban.expires_at > at;
}
