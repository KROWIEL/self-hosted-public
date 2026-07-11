import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DRIZZLE, Database } from '../../db/database.module';
import { gitCredentials } from '../../db/schema';
import { CryptoService } from '../../common/crypto/crypto.service';

const execFileAsync = promisify(execFile);

interface CreateGitCredentialInput {
  name: string;
  provider: 'GITHUB' | 'GITLAB';
  username?: string;
  pat: string;
}

@Injectable()
export class GitService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly crypto: CryptoService,
  ) {}

  async list() {
    const creds = await this.db
      .select()
      .from(gitCredentials)
      .orderBy(desc(gitCredentials.createdAt));
    // Never leak the encrypted PAT.
    return creds.map(({ patEnc, ...rest }) => rest);
  }

  async create(input: CreateGitCredentialInput) {
    const rows = await this.db
      .insert(gitCredentials)
      .values({
        name: input.name,
        provider: input.provider,
        username: input.username,
        patEnc: this.crypto.encrypt(input.pat),
      })
      .returning();
    const { patEnc, ...rest } = rows[0];
    return rest;
  }

  /** Returns the decrypted PAT for internal use (build pipeline only). */
  async getDecryptedPat(id: string): Promise<string> {
    const rows = await this.db
      .select()
      .from(gitCredentials)
      .where(eq(gitCredentials.id, id))
      .limit(1);
    if (!rows[0]) throw new NotFoundException('Credential not found');
    return this.crypto.decrypt(rows[0].patEnc);
  }

  /**
   * Validates a credential against a repo with an authenticated `git ls-remote`.
   * The PAT is injected into the remote URL in-memory only and scrubbed from any
   * error returned to the caller.
   */
  async verify(id: string, repoUrl: string) {
    if (!repoUrl || !/^https?:\/\//.test(repoUrl)) {
      return { ok: false, message: 'A valid https repo URL is required' };
    }
    const rows = await this.db
      .select()
      .from(gitCredentials)
      .where(eq(gitCredentials.id, id))
      .limit(1);
    if (!rows[0]) throw new NotFoundException('Credential not found');

    const cred = rows[0];
    const pat = this.crypto.decrypt(cred.patEnc);
    const authUrl = injectToken(repoUrl, cred.provider, cred.username, pat);

    try {
      await execFileAsync('git', ['ls-remote', authUrl, 'HEAD'], {
        timeout: 15_000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      });
      return { ok: true, message: 'Access OK' };
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      return { ok: false, message: scrub(raw, pat) };
    }
  }

  async remove(id: string) {
    const rows = await this.db
      .select()
      .from(gitCredentials)
      .where(eq(gitCredentials.id, id))
      .limit(1);
    if (!rows[0]) throw new NotFoundException('Credential not found');
    await this.db.delete(gitCredentials).where(eq(gitCredentials.id, id));
    return { ok: true };
  }
}

/** Builds an https URL with the PAT embedded for an authenticated clone/ls-remote. */
function injectToken(
  repoUrl: string,
  provider: string,
  username: string | null,
  pat: string,
): string {
  const rest = repoUrl.replace(/^https?:\/\//, '');
  const user =
    username && username.length > 0
      ? username
      : provider === 'GITLAB'
        ? 'oauth2'
        : 'x-access-token';
  return `https://${user}:${pat}@${rest}`;
}

/** Removes the PAT (and any embedded credentials) from a string. */
function scrub(text: string, pat: string): string {
  return text
    .split(pat)
    .join('***')
    .replace(/https:\/\/[^@\s/]+:[^@\s/]+@/g, 'https://***@');
}
