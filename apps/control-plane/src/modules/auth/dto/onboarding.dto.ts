import { IsNotEmpty, IsString, Length, MaxLength } from 'class-validator';

export class OnboardingDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName: string;

  /** Base32 TOTP secret returned by /auth/2fa/setup and shown as a QR. */
  @IsString()
  @IsNotEmpty()
  totpSecret: string;

  /** 6-digit code from the authenticator app confirming the secret was stored. */
  @IsString()
  @Length(6, 6)
  totpCode: string;
}
