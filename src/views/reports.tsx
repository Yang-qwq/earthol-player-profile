/**
 * The reporter's own inbox (`/reports`): every report they filed, its current
 * moderation state, and the moderator receipts attached to it. Receipts are
 * marked read when this page renders, so the sidebar badge clears on the next
 * navigation; this render still shows which ones were new.
 */
import { Layout } from './layout';
import type { ReportReceiptRow, ReportRow } from '../db/types';
import {
  REPORT_REASON_KEYS,
  REPORT_STATUS_KEYS,
  isReportReason,
  isReportStatus,
} from '../lib/moderation';
import type { Locale, TranslateFn } from '../i18n';

export interface ReportsInboxProps {
  appName: string;
  faviconUrl: string;
  logoUrl: string;
  customCss?: string;
  customJs?: string;
  customFooter?: string;
  csrfToken: string;
  currentUser: { username: string; displayName?: string | null; avatarUrl?: string | null } | null;
  isAdmin?: boolean;
  reports: ReportRow[];
  receipts: ReportReceiptRow[];
  /** Unread receipts as of this render (before they are marked read). */
  receiptUnread: number;
  nonce?: string;
  t: TranslateFn;
  locale: Locale;
}

function formatDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function statusClass(status: string): string {
  if (status === 'open') return 'chip bg-warning/10 text-warning';
  if (status === 'resolved') return 'chip bg-success/10 text-success';
  return 'chip bg-muted text-muted-foreground';
}

function targetName(report: ReportRow): string {
  return report.target_display_name || (report.target_username ? `@${report.target_username}` : '—');
}

export function ReportsInbox({
  appName,
  faviconUrl,
  logoUrl,
  customCss,
  customJs,
  customFooter,
  csrfToken,
  currentUser,
  isAdmin,
  reports,
  receipts,
  receiptUnread,
  nonce,
  t,
  locale,
}: ReportsInboxProps) {
  const byReport = new Map<string, ReportReceiptRow[]>();
  for (const receipt of receipts) {
    const list = byReport.get(receipt.report_id);
    if (list) list.push(receipt);
    else byReport.set(receipt.report_id, [receipt]);
  }

  const openCount = reports.filter((report) => report.status === 'open').length;
  const closedCount = reports.length - openCount;

  return (
    <Layout
      appName={appName}
      faviconUrl={faviconUrl}
      logoUrl={logoUrl}
      customCss={customCss}
      customJs={customJs}
      customFooter={customFooter}
      title={t('reports.title')}
      robots="noindex, nofollow"
      shell="console"
      csrfToken={csrfToken}
      currentUser={currentUser}
      nonce={nonce}
      t={t}
      locale={locale}
      pathname="/reports"
      isAdmin={isAdmin}
      receiptUnread={receiptUnread}
    >
      <section class="space-y-6">
        <div class="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 class="text-xl font-bold tracking-tight">{t('reports.title')}</h1>
            <p class="mt-0.5 text-sm text-muted-foreground">{t('reports.subtitle')}</p>
          </div>
          {receiptUnread > 0 ? (
            <span class="chip bg-danger/10 text-danger">
              {t('reports.unread', { count: receiptUnread })}
            </span>
          ) : null}
        </div>

        {reports.length > 0 ? (
          <div class="grid gap-4 sm:grid-cols-3">
            <div class="card p-5">
              <p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('reports.stat.total')}
              </p>
              <p class="mt-1 text-3xl font-bold tabular-nums">{reports.length}</p>
            </div>
            <div class="card p-5">
              <p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('reports.stat.open')}
              </p>
              <p class="mt-1 text-3xl font-bold tabular-nums">{openCount}</p>
            </div>
            <div class="card p-5">
              <p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('reports.stat.closed')}
              </p>
              <p class="mt-1 text-3xl font-bold tabular-nums">{closedCount}</p>
            </div>
          </div>
        ) : null}

        {reports.length === 0 ? (
          <div class="card p-8 text-center">
            <span class="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-muted text-muted-foreground">
              <span class="material-symbols-outlined" aria-hidden="true">
                inbox
              </span>
            </span>
            <h2 class="mt-3 text-lg font-bold tracking-tight">{t('reports.empty')}</h2>
            <p class="mt-1 text-sm text-muted-foreground">{t('reports.emptyBody')}</p>
          </div>
        ) : (
          <div class="space-y-4">
            {reports.map((report) => {
              const replies = byReport.get(report.id) ?? [];
              return (
                <article key={report.id} class="card p-5" data-my-report>
                  <div class="flex flex-wrap items-start justify-between gap-2">
                    <div class="min-w-0">
                      <p class="flex flex-wrap items-center gap-2 text-sm font-semibold">
                        {report.target_username ? (
                          <a
                            href={`/${report.target_username}`}
                            class="hover:text-primary hover:underline"
                          >
                            {targetName(report)}
                          </a>
                        ) : (
                          <span>{targetName(report)}</span>
                        )}
                        <span class={statusClass(report.status)}>
                          {isReportStatus(report.status)
                            ? t(REPORT_STATUS_KEYS[report.status])
                            : report.status}
                        </span>
                        <span class="chip bg-muted text-muted-foreground">
                          {isReportReason(report.reason)
                            ? t(REPORT_REASON_KEYS[report.reason])
                            : report.reason}
                        </span>
                      </p>
                      <p class="mt-1 text-xs text-muted-foreground">
                        {t('reports.submitted', { date: formatDate(report.created_at) })}
                      </p>
                    </div>
                  </div>

                  {report.details ? (
                    <div class="mt-3 rounded-xl bg-muted px-3 py-2">
                      <p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {t('reports.yourDetails')}
                      </p>
                      <p class="mt-1 whitespace-pre-wrap text-sm text-foreground/90">
                        {report.details}
                      </p>
                    </div>
                  ) : null}

                  <div class="mt-4 border-t border-border/60 pt-3">
                    <p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t('reports.receipts')}
                    </p>
                    {replies.length === 0 ? (
                      <p class="mt-1 text-sm text-muted-foreground">{t('reports.noReceipts')}</p>
                    ) : (
                      <ul class="mt-2 space-y-2">
                        {replies.map((receipt) => (
                          <li
                            key={receipt.id}
                            class="rounded-xl border border-border/70 bg-primary/5 px-3 py-2"
                          >
                            <p class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              <span class="font-semibold text-foreground">
                                {receipt.admin_display_name ||
                                  (receipt.admin_username ? `@${receipt.admin_username}` : t('reports.staff'))}
                              </span>
                              <span>·</span>
                              <span>{formatDate(receipt.created_at)}</span>
                              {receipt.read_at === null ? (
                                <span class="chip bg-danger/10 text-danger">{t('reports.new')}</span>
                              ) : null}
                            </p>
                            <p class="mt-1 whitespace-pre-wrap text-sm text-foreground/90">
                              {receipt.body}
                            </p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </Layout>
  );
}
