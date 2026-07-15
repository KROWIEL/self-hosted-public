import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Admin-supplied OIDC configuration. All fields are optional so the form can
 * PATCH individual values; `clientSecret` is only persisted when a non-empty
 * value is provided (so re-saving without it keeps the stored secret).
 */
export class SetSsoConfigDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  issuer?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  clientId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  clientSecret?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  allowedDomains?: string;

  @IsOptional()
  @IsBoolean()
  autoCreate?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  buttonLabel?: string;
}
