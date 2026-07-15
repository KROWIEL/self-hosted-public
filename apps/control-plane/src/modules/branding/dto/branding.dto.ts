import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class SetBrandingDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  appName?: string;

  // Empty string clears the logo.
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  logoUrl?: string;

  // Hex colour like #6366f1 (validated loosely; the UI uses a colour picker).
  @IsOptional()
  @IsString()
  @MaxLength(32)
  accentColor?: string;

  @IsOptional()
  @IsBoolean()
  hidePoweredBy?: boolean;
}
