import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { CryptoService } from '../../common/crypto/crypto.service';
import { EntitlementsService } from '../../common/licensing/entitlements.service';
import { AuthErrors } from '../../common/errors/app-errors';
import { isStrongPassword } from '../../common/validation/password';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { OnboardingDto } from './dto/onboarding.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { Enable2faDto } from './dto/enable-2fa.dto';
import { Disable2faDto } from './dto/disable-2fa.dto';

const TOTP_ISSUER = process.env.TOTP_ISSUER ?? 'Self-Hosted Panel';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly crypto: CryptoService,
    private readonly entitlements: EntitlementsService,
  ) {}

  /** Stage 1: create the account and sign the user in so they can onboard. */
  async register(dto: RegisterDto) {
    const email = dto.email.toLowerCase();
    if (await this.users.findByEmail(email)) {
      throw AuthErrors.emailTaken();
    }
    if (!isStrongPassword(dto.password)) {
      throw AuthErrors.weakPassword();
    }
    const user = await this.users.create(email, dto.password, 'USER');
    const tokens = await this.issueTokens(user.id, user.email, user.role);
    return { ...tokens, needsOnboarding: true };
  }

  async login(dto: LoginDto) {
    const email = dto.email.toLowerCase();
    const user = await this.users.findByEmail(email);
    if (!user) {
      throw AuthErrors.invalidCredentials();
    }
    const ok = await this.users.verifyPassword(dto.password, user.password);
    if (!ok) {
      throw AuthErrors.invalidCredentials();
    }

    // Enforce TOTP once 2FA has been enabled for the account.
    if (user.totpSecret) {
      if (!dto.totp) throw AuthErrors.totpRequired();
      const secret = this.crypto.decrypt(user.totpSecret);
      if (!authenticator.check(dto.totp, secret)) {
        throw AuthErrors.totpInvalid();
      }
    }

    // Soft-enforce the current password policy: flag weak passwords so the UI
    // can force a change on next use, without ever blocking sign-in.
    const mustChangePassword = !isStrongPassword(dto.password);
    if (mustChangePassword !== user.mustChangePassword) {
      await this.users.setMustChangePassword(user.id, mustChangePassword);
    }

    const tokens = await this.issueTokens(user.id, user.email, user.role);
    return {
      ...tokens,
      needsOnboarding: !user.onboardedAt,
      mustChangePassword,
    };
  }

  /**
   * Stage 2 helper: mints a fresh TOTP secret + QR for the user to scan. The
   * secret isn't persisted until they confirm a code in `completeOnboarding`.
   */
  async begin2fa(userId: string) {
    const user = await this.users.findById(userId);
    if (!user) throw AuthErrors.invalidCredentials();
    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(user.email, TOTP_ISSUER, secret);
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl);
    return { secret, otpauthUrl, qrDataUrl };
  }

  /** Stage 2: verify the TOTP code, then persist personal data + enable 2FA. */
  async completeOnboarding(userId: string, dto: OnboardingDto) {
    const user = await this.users.findById(userId);
    if (!user) throw AuthErrors.invalidCredentials();
    if (user.onboardedAt) throw AuthErrors.alreadyOnboarded();

    if (!authenticator.check(dto.totpCode, dto.totpSecret)) {
      throw AuthErrors.totpInvalid();
    }

    await this.users.completeOnboarding(userId, {
      firstName: dto.firstName.trim(),
      lastName: dto.lastName.trim(),
      totpSecretEnc: this.crypto.encrypt(dto.totpSecret),
    });
    return { ok: true };
  }

  /** Settings: update personal data on an already-onboarded account. */
  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.users.findById(userId);
    if (!user) throw AuthErrors.invalidCredentials();
    await this.users.updateProfile(userId, {
      firstName: dto.firstName.trim(),
      lastName: dto.lastName.trim(),
    });
    return { ok: true };
  }

  /** Settings: change password after verifying the current one. */
  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.users.findById(userId);
    if (!user) throw AuthErrors.invalidCredentials();
    const ok = await this.users.verifyPassword(
      dto.currentPassword,
      user.password,
    );
    if (!ok) throw AuthErrors.currentPasswordInvalid();
    if (!isStrongPassword(dto.newPassword)) {
      throw AuthErrors.weakPassword();
    }
    await this.users.updatePassword(userId, dto.newPassword);
    await this.users.setMustChangePassword(userId, false);
    return { ok: true };
  }

  /** Settings: enable 2FA by confirming a code for the freshly issued secret. */
  async enable2fa(userId: string, dto: Enable2faDto) {
    const user = await this.users.findById(userId);
    if (!user) throw AuthErrors.invalidCredentials();
    if (user.totpSecret) throw AuthErrors.twoFactorAlreadyEnabled();
    if (!authenticator.check(dto.totpCode, dto.totpSecret)) {
      throw AuthErrors.totpInvalid();
    }
    await this.users.setTotpSecret(userId, this.crypto.encrypt(dto.totpSecret));
    return { ok: true };
  }

  /** Settings: disable 2FA after re-verifying the account password. */
  async disable2fa(userId: string, dto: Disable2faDto) {
    const user = await this.users.findById(userId);
    if (!user) throw AuthErrors.invalidCredentials();
    if (!user.totpSecret) throw AuthErrors.twoFactorNotEnabled();
    const ok = await this.users.verifyPassword(dto.password, user.password);
    if (!ok) throw AuthErrors.currentPasswordInvalid();
    await this.users.setTotpSecret(userId, null);
    return { ok: true };
  }

  async me(userId: string) {
    const user = await this.users.findById(userId);
    if (!user) throw AuthErrors.invalidCredentials();
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      firstName: user.firstName,
      lastName: user.lastName,
      twoFactor: !!user.totpSecret,
      onboardedAt: user.onboardedAt,
      needsOnboarding: !user.onboardedAt,
      mustChangePassword: user.mustChangePassword,
      entitlements: await this.entitlements.get(),
    };
  }

  async refresh(refreshToken: string) {
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string }>(refreshToken, {
        secret: process.env.JWT_REFRESH_SECRET,
      });
      const user = await this.users.findById(payload.sub);
      if (!user) throw AuthErrors.invalidRefresh();
      return this.issueTokens(user.id, user.email, user.role);
    } catch {
      throw AuthErrors.invalidRefresh();
    }
  }

  private async issueTokens(sub: string, email: string, role: string) {
    const payload = { sub, email, role };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: process.env.JWT_SECRET,
      expiresIn: process.env.JWT_EXPIRES_IN ?? '15m',
    });
    const refreshToken = await this.jwt.signAsync(payload, {
      secret: process.env.JWT_REFRESH_SECRET,
      expiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
    });
    return { accessToken, refreshToken };
  }
}
