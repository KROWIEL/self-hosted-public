import { IsNotEmpty, IsString, Length } from 'class-validator';

export class Enable2faDto {
  /** Base32 TOTP secret returned by /auth/2fa/setup and shown as a QR. */
  @IsString()
  @IsNotEmpty()
  totpSecret: string;

  /** 6-digit code from the authenticator app confirming the secret. */
  @IsString()
  @Length(6, 6)
  totpCode: string;
}
