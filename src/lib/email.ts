/**
 * Mailer abstraction. The default `console` driver logs messages (handy in
 * local dev); the `smtp` driver is a small hand-rolled client over
 * `cloudflare:sockets`. `routes/auth.tsx` renders send failures as generic
 * errors rather than surfacing transport details.
 */
import { connect } from 'cloudflare:sockets';
import type { TranslateFn } from '../i18n';
import type { MailerConfig } from './config';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

class ConsoleMailer implements Mailer {
  async send(message: MailMessage): Promise<void> {
    console.log(
      `[mailer:console] to=${message.to} subject="${message.subject}"\n${message.text}`,
    );
  }
}

/* -------------------------------- SMTP ---------------------------------
 * Minimal SMTP client over cloudflare:sockets. Supports implicit TLS
 * (port 465), STARTTLS (port 587), AUTH PLAIN/LOGIN and multipart
 * text+html messages. Plain text transport is only used when explicitly
 * configured (SMTP_SECURE=none, e.g. a local dev relay).
 * Note: Cloudflare blocks outbound port 25 — use 465 or 587 in production.
 * ---------------------------------------------------------------------- */

type SecureMode = 'tls' | 'starttls' | 'none';

interface SmtpConfig {
  host: string;
  port: number;
  secure: SecureMode;
  user?: string;
  password?: string;
  from: string;
}

const SMTP_TIMEOUT_MS = 12_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function base64(data: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < data.length; i += chunk) {
    binary += String.fromCharCode(...data.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64Text(value: string): string {
  return base64(new TextEncoder().encode(value));
}

function rfc2047(value: string): string {
  // Encoded-word so localized (non-ASCII) subjects survive transport.
  return `=?UTF-8?B?${base64Text(value)}?=`;
}

function fold(base64Body: string): string {
  const lines: string[] = [];
  for (let i = 0; i < base64Body.length; i += 76) {
    lines.push(base64Body.slice(i, i + 76));
  }
  return lines.join('\r\n');
}

function addressOnly(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return match ? match[1] : from;
}

function buildMimeMessage(message: MailMessage, from: string, hostname: string): string {
  const headers = [
    `From: ${from}`,
    `To: ${message.to}`,
    `Subject: ${rfc2047(message.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${hostname}>`,
    'MIME-Version: 1.0',
  ];

  const parts: string[] = [];
  if (message.html) {
    const boundary = `----=_EarthOL_${crypto.randomUUID().replace(/-/g, '')}`;
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    parts.push(
      `--${boundary}`,
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      fold(base64Text(message.text)),
      `--${boundary}`,
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      fold(base64Text(message.html)),
      `--${boundary}--`,
    );
  } else {
    headers.push('Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64');
    parts.push('', fold(base64Text(message.text)));
  }

  // Dot-stuffing guards lines starting with '.'; base64 parts never do.
  return [...headers, '', ...parts].join('\r\n').replace(/^\./gm, '..');
}

class SmtpSession {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private buffer = new Uint8Array(0);
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();

  constructor(private socket: Socket) {
    this.reader = socket.readable.getReader();
    this.writer = socket.writable.getWriter();
  }

  upgrade(socket: Socket): void {
    this.socket = socket;
    this.reader = socket.readable.getReader();
    this.writer = socket.writable.getWriter();
    this.buffer = new Uint8Array(0);
  }

  async close(): Promise<void> {
    try {
      this.reader.releaseLock();
    } catch {
      /* already closed */
    }
    try {
      this.writer.releaseLock();
    } catch {
      /* already closed */
    }
    await this.socket.close();
  }

  async send(line: string): Promise<void> {
    await withTimeout(this.writer.write(this.encoder.encode(`${line}\r\n`)), SMTP_TIMEOUT_MS, 'SMTP write');
  }

  private async readLine(): Promise<string> {
    for (;;) {
      const index = this.buffer.indexOf(0x0a);
      if (index >= 0) {
        let raw = this.decoder.decode(this.buffer.subarray(0, index));
        this.buffer = this.buffer.subarray(index + 1);
        if (raw.endsWith('\r')) raw = raw.slice(0, -1);
        return raw;
      }
      const { value, done } = await withTimeout(
        this.reader.read(),
        SMTP_TIMEOUT_MS,
        'SMTP read',
      );
      if (done) throw new Error('SMTP connection closed mid-reply');
      if (value) {
        const merged = new Uint8Array(this.buffer.length + value.length);
        merged.set(this.buffer);
        merged.set(value, this.buffer.length);
        this.buffer = merged;
      }
    }
  }

  /** Reads one full reply (handles continuation lines) and asserts the code. */
  async reply(expected: number[]): Promise<string[]> {
    const lines: string[] = [];
    for (;;) {
      const line = await this.readLine();
      lines.push(line);
      if (!/^\d{3}-/.test(line)) {
        const code = Number.parseInt(line.slice(0, 3), 10);
        if (!expected.includes(code)) {
          throw new Error(`SMTP expected ${expected.join('/')} but got: ${line}`);
        }
        return lines;
      }
    }
  }
}

class SmtpMailer implements Mailer {
  constructor(private readonly cfg: SmtpConfig) {}

  async send(message: MailMessage): Promise<void> {
    const transport =
      this.cfg.secure === 'tls' ? 'on' : this.cfg.secure === 'starttls' ? 'starttls' : 'off';
    const socket = connect(
      { hostname: this.cfg.host, port: this.cfg.port },
      { secureTransport: transport, allowHalfOpen: false },
    );

    let session: SmtpSession | null = null;
    try {
      await withTimeout(socket.opened, SMTP_TIMEOUT_MS, 'SMTP connect');
      session = new SmtpSession(socket);

      await session.reply([220]);
      let extensions = await this.ehlo(session);

      if (this.cfg.secure === 'starttls') {
        if (!extensions.has('STARTTLS')) {
          throw new Error(`SMTP server ${this.cfg.host} does not advertise STARTTLS`);
        }
        await session.send('STARTTLS');
        await session.reply([220]);
        session.upgrade(socket.startTls({ expectedServerHostname: this.cfg.host }));
        await session.reply([220]);
        extensions = await this.ehlo(session);
      }

      await this.authenticate(session, extensions);

      await session.send(`MAIL FROM:<${addressOnly(this.cfg.from)}>`);
      await session.reply([250]);
      await session.send(`RCPT TO:<${message.to}>`);
      await session.reply([250, 251]);
      await session.send('DATA');
      await session.reply([354]);
      await session.send(`${buildMimeMessage(message, this.cfg.from, this.cfg.host)}\r\n.`);
      await session.reply([250]);

      try {
        await session.send('QUIT');
      } catch {
        /* best effort */
      }
    } finally {
      await (session ?? { close: async () => void (await socket.close()) }).close().catch(() => {});
    }
  }

  /** Sends EHLO and returns extension name -> full parameter line. */
  private async ehlo(session: SmtpSession): Promise<Map<string, string>> {
    await session.send(`EHLO ${this.cfg.host}`);
    const lines = await session.reply([250]);
    const extensions = new Map<string, string>();
    for (const line of lines.slice(1)) {
      const match = /^\d{3}[- ](?<name>\S+)(?<rest>.*)$/.exec(line);
      if (match?.groups?.name) {
        extensions.set(match.groups.name.toUpperCase(), (match.groups.rest ?? '').trim());
      }
    }
    return extensions;
  }

  private async authenticate(session: SmtpSession, extensions: Map<string, string>): Promise<void> {
    if (!this.cfg.user || !this.cfg.password) return;
    const advertised = (extensions.get('AUTH') ?? '').toUpperCase();
    const offers = (mechanism: string) => !advertised || advertised.includes(mechanism);

    if (offers('PLAIN')) {
      const token = base64Text(`\u0000${this.cfg.user}\u0000${this.cfg.password}`);
      await session.send(`AUTH PLAIN ${token}`);
      await session.reply([235]);
      return;
    }
    if (offers('LOGIN')) {
      await session.send('AUTH LOGIN');
      await session.reply([334]);
      await session.send(base64Text(this.cfg.user));
      await session.reply([334]);
      await session.send(base64Text(this.cfg.password));
      await session.reply([235]);
      return;
    }
    throw new Error('SMTP server offers no AUTH PLAIN/LOGIN mechanism');
  }
}

export function getMailer(config: MailerConfig): Mailer {
  if (config.driver.toLowerCase() === 'smtp' && config.host) {
    const port = Number.parseInt(config.port, 10) || 465;
    const configured = config.secure.toLowerCase();
    const secure: SecureMode =
      configured === 'none' || configured === 'starttls' || configured === 'tls'
        ? (configured as SecureMode)
        : port === 465
          ? 'tls'
          : 'starttls';
    return new SmtpMailer({
      host: config.host,
      port,
      secure,
      user: config.user || undefined,
      password: config.password || undefined,
      from: config.from || config.user || 'no-reply@localhost',
    });
  }
  return new ConsoleMailer();
}

export function magicLinkEmail(
  t: TranslateFn,
  link: string,
  appName: string,
  minutes = 15,
): Pick<MailMessage, 'subject' | 'html' | 'text'> {
  // `appName` comes from the admin-editable site name; escape it before it is
  // interpolated into the HTML body.
  const safeAppName = escapeHtml(appName);
  const safeLink = escapeHtml(link);
  return {
    subject: t('email.subject', { appName }),
    text: `${t('email.textIntro', { appName, minutes })}\n\n${link}\n\n${t('email.textIgnore')}`,
    html: `<p>${t('email.htmlIntro', { appName: safeAppName, minutes })}</p>
<p><a href="${safeLink}">${t('email.htmlAction', { appName: safeAppName })}</a></p>
<p style="color:#64748b;font-size:13px">${t('email.htmlIgnore')}</p>`,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
