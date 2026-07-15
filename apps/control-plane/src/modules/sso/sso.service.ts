import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE, Database } from '../../db/database.module';
import { ssoConfig } from '../../db/schema';
import { CryptoService } from '../../common/crypto/crypto.service';
import { EntitlementsService } from '../../common/licensing/entitlements.service';
import { UsersService } from '../users/users.service';
import { AuthService } from '../auth/auth.service';
import { SsoErrors } from '../../common/errors/app-errors';
import { SetSsoConfigDto } from './dto/sso.dto';
import {
  discover,
  exchangeCode,
  randomToken,
  splitName,
  verifyIdToken,
} from './oidc';

const DEFAULT_LABEL = 'Sign in with SSO';
/** How long an authorization request (state) stays valid. */
const STATE_TTL_MS = 10 * 60 * 1000;

/** Minimal shape of the incoming request we read headers from. */
export interface ReqLike {
  headers?: Record<string, string | string[] | undefined>;
  protocol?: string;
}

interface StatePayload {
  nonce: string;
  exp: number;
}

/**
 * Single sign-on via OpenID Connect (Pro: sso). Stores a singleton IdP config
 * and drives the Authorization Code flow: `buildAuthUrl` starts it, and
 * `handleCallback` completes it by verifying the ID token and minting a normal
 * panel session for the (optionally auto-provisioned) local user.
 *
 * State/nonce are carried in a self-contained, encrypted `state` value so no
 * server-side session store is needed: the panel decrypts it on callback to
 * recover (and validate) the nonce it embedded in the auth request.
 */
@Injectable()
export class SsoService {
  private readonly logger = new Logger(SsoService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly crypto: CryptoService,
    private readonly entitlements: EntitlementsService,
    private readonly users: UsersService,
    private readonly auth: AuthService,
  ) {}

  private async row() {
    const [r] = await this.db
      .select()
      .from(ssoConfig)
      .where(eq(ssoConfig.id, 'default'))
      .limit(1);
    return r ?? null;
  }

  private originFromReq(req: ReqLike | null): string {
    const h = req?.headers ?? {};
    const xfProto = String(h['x-forwarded-proto'] ?? '')
      .split(',')[0]
      .trim();
    const proto = xfProto || req?.protocol || 'http';
    const host = String(h['x-forwarded-host'] ?? h['host'] ?? 'localhost:3001')
      .split(',')[0]
      .trim();
    return `${proto}://${host}`;
  }

  /** The exact OIDC redirect URI (must be registered at the provider). */
  redirectUri(req: ReqLike | null): string {
    const envApi = process.env.PUBLIC_API_URL?.trim();
    if (envApi) return `${envApi.replace(/\/+$/, '')}/auth/sso/callback`;
    return `${this.originFromReq(req)}/api/v1/auth/sso/callback`;
  }

  /** Base URL of the web app we redirect back to after SSO completes. */
  private appBase(): string {
    const env = process.env.APP_BASE_URL?.trim();
    return env ? env.replace(/\/+$/, '') : 'http://localhost:3000';
  }

  /** Public status used by the login page to decide whether to show the button. */
  async status(): Promise<{ enabled: boolean; label: string }> {
    const licensed = await this.entitlements.hasModule('sso');
    const r = await this.row();
    const configured = !!(r && r.issuer && r.clientId && r.clientSecretEnc);
    return {
      enabled: licensed && !!r?.enabled && configured,
      label: r?.buttonLabel?.trim() || DEFAULT_LABEL,
    };
  }

  /** Admin view of the config (never returns the stored secret). */
  async getConfig(req: ReqLike | null) {
    const r = await this.row();
    return {
      enabled: r?.enabled ?? false,
      issuer: r?.issuer ?? '',
      clientId: r?.clientId ?? '',
      hasSecret: !!r?.clientSecretEnc,
      allowedDomains: r?.allowedDomains ?? '',
      autoCreate: r?.autoCreate ?? true,
      buttonLabel: r?.buttonLabel ?? DEFAULT_LABEL,
      redirectUri: this.redirectUri(req),
    };
  }

  async setConfig(dto: SetSsoConfigDto) {
    const existing = await this.row();
    let clientSecretEnc = existing?.clientSecretEnc ?? '';
    if (dto.clientSecret !== undefined && dto.clientSecret !== '') {
      clientSecretEnc = this.crypto.encrypt(dto.clientSecret);
    }
    const values = {
      id: 'default',
      enabled: dto.enabled ?? existing?.enabled ?? false,
      issuer: (dto.issuer ?? existing?.issuer ?? '').trim().replace(/\/+$/, ''),
      clientId: (dto.clientId ?? existing?.clientId ?? '').trim(),
      clientSecretEnc,
      allowedDomains: (dto.allowedDomains ?? existing?.allowedDomains ?? '').trim(),
      autoCreate: dto.autoCreate ?? existing?.autoCreate ?? true,
      buttonLabel: (dto.buttonLabel ?? existing?.buttonLabel ?? DEFAULT_LABEL).trim(),
      updatedAt: new Date(),
    };
    await this.db
      .insert(ssoConfig)
      .values(values)
      .onConflictDoUpdate({ target: ssoConfig.id, set: values });
  }

  /** Build the provider authorization URL to redirect the browser to. */
  async buildAuthUrl(req: ReqLike): Promise<string> {
    if (!(await this.entitlements.hasModule('sso'))) throw SsoErrors.notLicensed();
    const r = await this.row();
    if (!r || !r.enabled || !r.issuer || !r.clientId || !r.clientSecretEnc) {
      throw SsoErrors.notConfigured();
    }
    const disc = await discover(r.issuer);
    const nonce = randomToken(16);
    const state = this.crypto.encrypt(
      JSON.stringify({ nonce, exp: Date.now() + STATE_TTL_MS } as StatePayload),
    );
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: r.clientId,
      redirect_uri: this.redirectUri(req),
      scope: 'openid email profile',
      state,
      nonce,
    });
    return `${disc.authorization_endpoint}?${params.toString()}`;
  }

  /**
   * Complete the flow. Always returns a web-app URL to redirect to (never
   * throws): success carries the session tokens in the URL fragment, failure
   * carries a machine-readable `error` code the callback page localizes.
   */
  async handleCallback(
    req: ReqLike,
    q: { code?: string; state?: string; error?: string },
  ): Promise<string> {
    const appBase = this.appBase();
    const fail = (code: string) =>
      `${appBase}/sso/callback#error=${encodeURIComponent(code)}`;

    try {
      if (q.error) return fail(q.error);
      if (!q.code || !q.state) return fail('invalid_request');
      if (!(await this.entitlements.hasModule('sso'))) return fail('not_licensed');

      const r = await this.row();
      if (!r || !r.enabled || !r.issuer || !r.clientId || !r.clientSecretEnc) {
        return fail('not_configured');
      }

      let st: StatePayload;
      try {
        st = JSON.parse(this.crypto.decrypt(q.state)) as StatePayload;
      } catch {
        return fail('bad_state');
      }
      if (!st?.nonce || !st.exp || st.exp < Date.now()) return fail('bad_state');

      const clientSecret = this.crypto.decrypt(r.clientSecretEnc);
      const disc = await discover(r.issuer);
      const tokens = await exchangeCode(disc, {
        code: q.code,
        redirectUri: this.redirectUri(req),
        clientId: r.clientId,
        clientSecret,
      });
      const claims = await verifyIdToken(tokens.id_token, disc, {
        clientId: r.clientId,
        nonce: st.nonce,
      });

      const email = String(claims.email ?? '')
        .toLowerCase()
        .trim();
      if (!email) return fail('no_email');
      if (claims.email_verified === false) return fail('email_unverified');

      const allowed = (r.allowedDomains ?? '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      if (allowed.length) {
        const domain = email.split('@')[1] ?? '';
        if (!allowed.includes(domain)) return fail('domain_not_allowed');
      }

      let user = await this.users.findByEmail(email);
      if (!user) {
        if (!r.autoCreate) return fail('no_account');
        const parts = splitName(claims.name);
        user = await this.users.createSso(email, {
          firstName: (claims.given_name as string | undefined) ?? parts.first,
          lastName: (claims.family_name as string | undefined) ?? parts.last,
        });
      }

      const session = await this.auth.issueSessionFor({
        id: user.id,
        email: user.email,
        role: user.role,
      });
      const frag = new URLSearchParams({
        access: session.accessToken,
        refresh: session.refreshToken,
      });
      return `${appBase}/sso/callback#${frag.toString()}`;
    } catch (e) {
      this.logger.warn(`SSO callback failed: ${(e as Error).message}`);
      return fail('sso_failed');
    }
  }
}
