import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class SetCustomCertDto {
  @IsString()
  @MaxLength(64_000)
  certPem!: string;

  @IsString()
  @MaxLength(64_000)
  keyPem!: string;
}

export class SetTlsSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  acmeEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  dnsProvider?: string;

  @IsOptional()
  @IsBoolean()
  wildcardEnabled?: boolean;

  /** Omit to keep; send empty string to clear; send value to rotate. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  cloudflareToken?: string;
}
