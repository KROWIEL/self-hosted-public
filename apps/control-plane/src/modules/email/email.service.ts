import { Inject, Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { desc, eq } from 'drizzle-orm';
import { DRIZZLE, Database } from '../../db/database.module';
import { CryptoService } from '../../common/crypto/crypto.service';
import { emailConfig, emailMessages, users } from '../../db/schema';
import { EmailErrors } from '../../common/errors/app-errors';
import { SendMessageDto, SetEmailConfigDto } from './dto/email.dto';

type ConfigRow = typeof emailConfig.$inferSelect;

/** Split a free-form address list on commas / whitespace / newlines. */
function parseAddresses(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[\s,;]+/)) {
    const addr = part.trim().toLowerCase();
    if (!addr) continue;
    // Cheap sanity filter; the SMTP server is the real validator.
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) continue;
    if (seen.has(addr)) continue;
    seen.add(addr);
    out.push(addr);
  }
  return out;
}

/**
 * Outbound email (Pro: email). A thin SMTP relay client that lets the panel send
 * and broadcast messages to users. This is intentionally send-only — there is no
 * inbound/receiving mail server. Credentials are encrypted at rest and never
 * returned to the UI.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly crypto: CryptoService,
  ) {}

  private async getConfigRow(): Promise<ConfigRow | null> {
    const [row] = await this.db
      .select()
      .from(emailConfig)
      .where(eq(emailConfig.id, 'default'))
      .limit(1);
    return row ?? null;
  }

  async getConfig() {
    const row = await this.getConfigRow();
    return {
      enabled: row?.enabled ?? false,
      host: row?.host ?? '',
      port: row?.port ?? 587,
      secure: row?.secure ?? false,
      username: row?.username ?? '',
      fromName: row?.fromName ?? 'Self-Hosted',
      fromEmail: row?.fromEmail ?? '',
      // Never expose the stored password; only whether one is set.
      passwordSet: !!row?.passwordEnc,
      updatedAt: row?.updatedAt ?? null,
    };
  }

  async setConfig(dto: SetEmailConfigDto) {
    const existing = await this.getConfigRow();
    const passwordEnc = dto.password
      ? this.crypto.encrypt(dto.password)
      : existing?.passwordEnc ?? '';
    const values = {
      id: 'default',
      enabled: dto.enabled ?? existing?.enabled ?? false,
      host: dto.host ?? existing?.host ?? '',
      port: dto.port ?? existing?.port ?? 587,
      secure: dto.secure ?? existing?.secure ?? false,
      username: dto.username ?? existing?.username ?? '',
      passwordEnc,
      fromName: dto.fromName ?? existing?.fromName ?? 'Self-Hosted',
      fromEmail: dto.fromEmail ?? existing?.fromEmail ?? '',
      updatedAt: new Date(),
    };
    await this.db
      .insert(emailConfig)
      .values(values)
      .onConflictDoUpdate({ target: emailConfig.id, set: values });
    return this.getConfig();
  }

  /** Build an SMTP transporter from the stored config, or fail if incomplete. */
  private async transporter(): Promise<{ row: ConfigRow; tx: Transporter }> {
    const row = await this.getConfigRow();
    if (!row || !row.host || !row.fromEmail) throw EmailErrors.notConfigured();
    const tx = createTransport({
      host: row.host,
      port: row.port,
      secure: row.secure,
      auth: row.username
        ? {
            user: row.username,
            pass: row.passwordEnc ? this.crypto.decrypt(row.passwordEnc) : '',
          }
        : undefined,
    });
    return { row, tx };
  }

  private fromHeader(row: ConfigRow): string {
    return row.fromName ? `"${row.fromName}" <${row.fromEmail}>` : row.fromEmail;
  }

  /** Verify SMTP connectivity + credentials, then send a single test email. */
  async sendTest(to?: string): Promise<{ ok: true; to: string }> {
    const { row, tx } = await this.transporter();
    const target = (to || row.fromEmail).trim();
    try {
      await tx.verify();
      await tx.sendMail({
        from: this.fromHeader(row),
        to: target,
        subject: 'Test email from your self-hosted panel',
        text:
          'This is a test message confirming your SMTP settings work. ' +
          'If you received it, outbound email is configured correctly.',
      });
      return { ok: true, to: target };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Email test send failed: ${msg}`);
      throw EmailErrors.sendFailed(msg.slice(0, 300));
    }
  }

  /** All registered users' email addresses (for "broadcast to everyone"). */
  private async allUserEmails(): Promise<string[]> {
    const rows = await this.db.select({ email: users.email }).from(users);
    return rows.map((r) => r.email).filter(Boolean);
  }

  async sendMessage(dto: SendMessageDto) {
    const { row, tx } = await this.transporter();

    const recipients =
      dto.recipientKind === 'all'
        ? await this.allUserEmails()
        : parseAddresses(dto.recipients ?? '');
    if (recipients.length === 0) throw EmailErrors.noRecipients();

    try {
      // BCC keeps recipients private from one another; a valid To is required,
      // so we address the message to the sender itself.
      await tx.sendMail({
        from: this.fromHeader(row),
        to: this.fromHeader(row),
        bcc: recipients,
        subject: dto.subject,
        text: dto.body,
      });
      const [logRow] = await this.db
        .insert(emailMessages)
        .values({
          subject: dto.subject,
          recipientKind: dto.recipientKind,
          recipientCount: recipients.length,
          status: 'sent',
        })
        .returning();
      return { ok: true, recipientCount: recipients.length, id: logRow.id };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.db.insert(emailMessages).values({
        subject: dto.subject,
        recipientKind: dto.recipientKind,
        recipientCount: recipients.length,
        status: 'failed',
        error: msg.slice(0, 1000),
      });
      this.logger.warn(`Email broadcast "${dto.subject}" failed: ${msg}`);
      throw EmailErrors.sendFailed(msg.slice(0, 300));
    }
  }

  listMessages(limit = 100) {
    return this.db
      .select()
      .from(emailMessages)
      .orderBy(desc(emailMessages.createdAt))
      .limit(Math.min(Math.max(limit, 1), 500));
  }
}
